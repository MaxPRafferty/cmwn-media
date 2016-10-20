'use strict';
var _ = require('lodash');
var Log = require('log');
var log = new Log('info');
var httprequest = require('request');

const IB_API_ENDPOINT = 'https://apius.intelligencebank.com';

const IB_PATHS = {
    LOGIN: '/webapp/1.0/login',
    RESOURCE: '/webapp/1.0/resources',
    SEARCH: '/webapp/1.0/search'
};

const IB_ERRORS = {
    SILLY: 'A server error occurred',
    LOGIN: 'Invalid user name or password. Please try again.',
    BAD_PLATFORM: 'Invalid user or password'
};

class IntelligenceBank {
    constructor(options = {}) {
        this.username = options.username || null;
        this.password = options.password || null;
        this.platformUrl = options.platformUrl || null;

        if (this.username === null) {
            throw 'Invalid Username passed in options';
        }

        if (this.password === null) {
            throw 'Invalid Password passed in options';
        }

        if (this.platformUrl === null) {
            throw 'Invalid platform url passed in options';
        }

        this.loginExpires = 0;
        this.lastLogin = null;
        this.apiKey = '';
        this.useruuid = '';
        this.tracking = '';
        this.baseUrl = options.baseUrl;
        this.onConnect = _.identity;
        this.httpRequest = httprequest.defaults({
            json: true,
            jar: true
        });
        this.transformFolder = options.transformFolder;
        this.transformAsset = options.transformAsset;
    }

    connect(options) {
        var self = this;
        var resourceUrl;
        var jar;
        var defaultOptions = {
            onConnect: _.identity,
            ownUrl: 'https://media.changemyworldnow.com'
        };

        options = _.defaults(options, defaultOptions);

        self.ownUrl = options.ownUrl || self.ownUrl;
        resourceUrl = 'f/';
        //bind transform methods to specified resource url
        self.transformAsset = self.transformAsset.bind(null, resourceUrl);
        self.transformFolder = self.transformFolder.bind(null, resourceUrl);
        self.onConnect = options.onConnect || self.onConnect;

        log.info('logging in as ' + JSON.stringify(options.username || 'cached user') + ' at ' + options.ownUrl);

        if (options.username != null) {
            self.username = options.username;
            self.password = options.password;
            return self.login()
                .then(loginDetails => {
                    jar = self.httpRequest.jar();
                    self.tracking = loginDetails.tracking;
                    self.apiKey = loginDetails.apiKey;
                    self.useruuid = loginDetails.useruuid;
                    jar.setCookie(self.tracking, IB_API_ENDPOINT);
                    self.httpRequest = httprequest.defaults({
                        json: true,
                        jar: jar /* MPR, 10/14/16: meesa sorry for this joke */
                    });
                })
                .catch(err => {
                    log.error('could not connect: ' + err);
                });
        } else if (options.apiKey != null) {
            self.apiKey = options.apiKey;
            self.useruuid = options.useruuid;
            self.tracking = options.tracking;
            jar = self.httpRequest.jar();
            jar.setCookie(options.tracking, IB_API_ENDPOINT);
            self.httpRequest = httprequest.defaults({
                json: true,
                jar: jar
            });
            log.info('connection success (cache). setting keys');
            return Promise.resolve(options);
        } else {
            log.error('no login info provided and no cache exists. Cannot proceed.');
        }
    }

    login() {
        let self = this;
        let loginOptions = {
            'url': IB_API_ENDPOINT + IB_PATHS.LOGIN,
            'form': {
                'p70': self.username,
                'p80': self.password,
                'p90': self.platformUrl
            }
        };

        return new Promise((resolve, reject) => {
            var result = {};
            var jar = self.httpRequest.jar();
            loginOptions.jar = jar;
            self.httpRequest.post(loginOptions, function (err, response, data) {
                if (err) {
                    log.error(err);
                    reject({status: 500, message: 'Internal server error [0x1F4]'});
                    return;
                }

                if (Number(response.statusCode) > 300 || Number(response.statusCode) < 199) {
                    log.error('Invalid response code', response);
                    reject({status: 500, message: 'Internal server error [0x193]'});
                    return;
                }

                if (data.message === IB_ERRORS.LOGIN) {
                    log.error('Login credentials');
                    reject({status: 500, message: 'Internal server error [0x191]'});
                    return;
                }

                if (data.message === IB_ERRORS.BAD_PLATFORM) {
                    log.error('Invalid platform specified');
                    reject({status: 500, message: 'Internal server error [0x1F1]'});
                    return;
                }

                result.apiKey = data.apikey; //second key is intentionally lowercase
                result.useruuid = data.useruuid;
                result.tracking = jar.getCookieString(loginOptions.url);
                log.info('Login successful');
                self.onConnect(result);
                resolve(result);
            });
        });
    }

    makeHTTPCall(options) {
        var self = this;
        var loginPromise = options.forceLogin ?
                this.login() :
                Promise.resolve({
                    apiKey: self.apiKey,
                    useruuid: self.apiKey,
                    tracking: self.tracking
                });

        return new Promise(function (resolve, reject) {
            loginPromise.then(function (loginDetails) {
                log.info('connecting as ' + JSON.stringify(loginDetails));
                options.qs = options.qs || {};
                options.qs.p10 = self.apiKey;
                options.qs.p20 = self.useruuid;
                options.cookie = self.tracking;
                try {
                    self.httpRequest.get(options, function (err, response, data) {
                        if (err) {
                            log.error(err);
                            throw ({status: 500, message: 'Internal server error [0x1F5]'});
                        }

                        if (Number(response.statusCode) > 300 || Number(response.statusCode) < 199) {
                            log.error('Invalid response code', response);
                            throw ({status: 500, message: 'Internal server error [0x1F2]'});
                        }

                        if (data.message === IB_ERRORS.SILLY) {
                            log.error('', data);
                            throw ({status: 404, message: 'Not Found'});
                        }

                        if (data.message === IB_ERRORS.LOGIN) {
                            throw ({status: 401, message: 'Invalid Login. User not authorized'});
                        }

                        log.info('got data');
                        resolve(data.response);
                    });
                } catch(err) {
                    if (!options.forceLogin) {
                        log.info('Request failed for reason: ' + err + '. Cached login information expired. Retrying with explicit login');
                        options.forceLogin = true;
                        self.makeHTTPCall(options).then(result => resolve(result)).catch(err_ => reject(err_));
                    } else {
                        log.error(err);
                        reject(err);
                    }
                }
            }
        ); });
    }

    getFolderInfo(options) {
        var self = this;
        var resolve;
        var reject;
        var err;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });

        var qs = {};
        log.info('getting folder using query: ' + JSON.stringify(options));
        //very simple. If an id is provided, retrieve it directly. If a path is provided, walk the tree until it is found
        try {
            if (options.id != null || (options.id == null && options.path == null)) {
                log.info('getting folder by id');
                if (options.id != null) {
                    qs.folderuuid = options.id;
                }
                self.makeHTTPCall({
                    uri: self.baseUrl + IB_PATHS.RESOURCE,
                    qs: qs
                })
                    .then(function (data) {
                        try {
                            log.info('got folder data for folder ' + options.id);

                            if (data && data.folder) {
                                // evidently data.response doesnt exist sometimes so... k.
                                resolve(self.transformFolder(options.id, data));
                            } else if (data && data.response) {
                                resolve(self.transformFolder(options.id, data.response));
                            } else {
                                log.warning('No response for folder information');
                                reject({status: 404, message: 'Not Found'});
                            }
                        } catch(err_) {
                            log.error('bad data recieved from server: ' + err_);
                            reject({status: 500, message: 'Internal server error [0x1F2]'});
                        }
                    })
                    .catch(function (err_) {
                        reject(err_);
                    });
            } else if (options.path) {
                self.getFolderByPath(options.path)
                    .then(function (data) {
                        resolve(data);//no need to transform, happens in getFolderByPath
                    })
                    .catch(function (err_) {
                        log.error(err_);
                        reject(err_);
                    });
            } else {
                err = 'No ID or path provided. Folder cannot be retrieved. Options passed: ' + JSON.stringify(options);
                log.error(err);
                reject(err);
            }
        } catch(err_) {
            log.error('unknown error: ' + err_);
            reject(err_);
        }
        return folder;
    }
    /**
     * getFolderByPath
     * IB doesn't access items by path, so if we want to accomplish this, we need
     * to walk down the tree and search for it. Our transform function in the IB
     * service will be caching everything by both path and ID, however, so we will
     * only be falling back to this source of truth as the cache expires.
     */
    getFolderByPath(pathToMatch, currentPath, currentFolderId, foldersSearched = 0) {
        log.info('getting folder by path');
        currentPath = currentPath || '';
        currentFolderId = currentFolderId || '';
        var self = this;
        var resolve;
        var reject;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        var options = {
            uri: self.baseUrl + IB_PATHS.RESOURCE,
            qs: {
                folderuuid: currentFolderId
            }
        };
        // eslint-disable-next-line curly
        if (currentFolderId === '') delete options.qs.folderuuid;
        self.makeHTTPCall(options)
            .then(function (data) {
                var newPath;
                //we are being naughty and using side effects of this transformation for
                //caching purposes, hence why we are calling it all the time.
                var transformedFolder = self.transformFolder(undefined, data);
                if (currentPath === pathToMatch) {
                    resolve(transformedFolder);
                } else {
                    _.some(transformedFolder.items, function (item) {
                        if (item.name === pathToMatch.split('/')[foldersSearched]) {
                            newPath = currentPath ? currentPath + '/' + item.name : item.name;
                            self.getFolderByPath(pathToMatch, newPath, item.media_id || item.fileuuid, ++foldersSearched)
                                .then(function (data_) {
                                    resolve(data_); //again, no need to double transform
                                })
                                .catch(function () {
                                    foldersSearched++;
                                    if (foldersSearched === data.response.folder.length) {
                                        reject('folder does not exist in subtree path ' + currentPath + item.name);
                                    }
                                });
                            return true;
                        }
                    });
                }
            })
            .catch(function (err) {
                log.error(err);
                reject(err);
            });
        return folder;
    }
    getAssetInfo(options) {
        //this.getAssetFromTree(options);
        var self = this;
        var resolve;
        var reject;
        var err;
        var file = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        log.info('getting asset with apiKey: ' + self.apiKey);
        //very simple. If an id is provided, retrieve it directly. If a path is provided, walk the tree until it is found
        try {
            if (options.id) {
                log.info('getting asset by id');
                self.makeHTTPCall({
                    uri: self.baseUrl + IB_PATHS.SEARCH,
                    qs: {
                        searchterm: options.id
                    }
                })
                    .then(function (data) {
                        try {
                            log.info('got asset data for asset ' + options.id);

                            if (!data.doc || data.numFound !== '1') {
                                log.warning('No response for server information');
                                reject(data);
                            } else {
                                resolve(self.transformAsset(data.doc[0]));
                            }
                        } catch(err_) {
                            log.error('bad data recieved from server: ' + err_);
                            reject(err_);
                        }
                    })
                    .catch(function (err_) {
                        reject(err_);
                    });
            } else if (options.path) {
                self.getAssetFromTree(options.path)
                    .then(function (data) {
                        resolve(data);//no need to transform, happens in getAssetsFromTreee
                    })
                    .catch(function (err_) {
                        log.error(err_);
                        reject(err_);
                    });
            } else {
                err = 'No ID or path provided. Asset cannot be retrieved. Options passed: ' + JSON.stringify(options);
                log.error(err);
                reject(err);
            }
        } catch(err_) {
            log.error('unknown error: ' + err_);
            reject(err_);
        }
        return file;
    }
    /**
     * getAssetFromTree
     * There is some definite weirdness with the IB API. Namely, they seem to hate returning identities.
     * As a result, asset information can only be retrieved by accessing the folder it belongs to.
     * As of my current understanding of their API, only raw assets can be retrieved by direct ID.
     * What this means, is that regardless of whether of not we are looking an asset up by ID or Path,
     * we need to traverse the entire folder tree in search of it.
     * While this is fine for now, if there is ANY sort of pagination this will likely become unsustainable
     * At that point, we will need to write a cron job to just walk the tree, and prime the cache with all
     * images nightly.
     */
    getAssetFromTree(targetOptions, currentPath, currentFolderId) {
        currentPath = currentPath || '';
        currentFolderId = currentFolderId || '';
        var resolve;
        var reject;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        var options = {
            uri: this.baseUrl + IB_PATHS.RESOURCE,
            qs: {
                folderuuid: currentFolderId
            }
        };
        // eslint-disable-next-line curly
        if (currentFolderId === '') delete options.qs.folderuuid;
        this.makeHTTPCall(options)
            .then(function (data) {
                var foldersSearched = 0;
                _.each(data.response.resource, function (item) {
                    //we are being naughty and using side effects of this transformation for
                    //caching purposes, hence why we are calling it all the time.
                    var transformedItem = this.transformAsset(item);
                    if (item.media_id === targetOptions.id) {
                        resolve(transformedItem);
                    }
                    if (currentPath + '/' + item.title === targetOptions.path) {
                        resolve(transformedItem);
                    }
                });
                _.each(data.response.folder, function (item) {
                    //this side effect transformation is particularly egregious, were not even using the
                    //output! Eat your heart out, Church.
                    //this.transformFolder(item);
                    this.getAssetFromTree(targetOptions, currentPath + item.name, item.folderuuid)
                        .then(function (data_) {
                            resolve(data_); //again, no need to double transform
                        })
                        .catch(function () {
                            foldersSearched++;
                            if (foldersSearched === data.response.folder.length) {
                                reject('folder does not exist in subtree path ' + currentPath + item.name);
                            }
                        });
                });
            })
            .catch(function (err) {
                log.error(err);
                reject(err);
            });
        return folder;
    }
    getAssetUrl(file) {
        var assetId = file.split('?')[0];
        var assetArray = assetId.split('.');
        var ext = assetArray.pop();
        assetId = assetArray.join('.');
        var query = file.split('?')[1];

        var resolve;
        var reject;
        var asset = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });

        if (assetId !== '0' && (assetId.indexOf('/') !== -1 || assetId.length !== 32)) {
            this.getAssetIdByPath(assetId + '.' + ext)
            .then(assetIdFromPath => {
                var resourceUrl =
                    IB_API_ENDPOINT + IB_PATHS.RESOURCE +
                    '?p10=' + this.apiKey +
                    '&p20=' + this.useruuid +
                    '&fileuuid=' + assetIdFromPath +
                    '&ext=' + ext +
                    (query ? '&' + query : '');
                log.info('trying to display image from ' + resourceUrl);
                resolve(resourceUrl);
            })
            .catch(err => {
                reject(err);
            });
        } else {
            var resourceUrl =
                IB_API_ENDPOINT + IB_PATHS.RESOURCE +
                '?p10=' + this.apiKey +
                '&p20=' + this.useruuid +
                '&fileuuid=' + assetId +
                '&ext=' + ext +
                (query ? '&' + query : '');
            log.info('trying to display image from ' + resourceUrl);
            resolve(resourceUrl);
        }

        return asset;
    }
    getAssetIdByPath(path) {
        var folderPath = path.split('/');
        var filename = folderPath.pop();
        folderPath = folderPath.join('/');

        var resolve;
        var reject;
        var assetId = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });

        this.getFolderByPath(folderPath)
        .then(folderInfo => {
            _.some(folderInfo.items, item => {
                if (item.origfilename === filename) {
                    resolve(item.media_id);
                    return true;
                }
            });
        })
        .catch(err => {
            reject(err);
        });

        return assetId;
    }
    getTracking() {
        return this.tracking;
    }
    // getAsset(options = {}, assetId = 0) {
    //     var self = this;
    //     var loginPromise = options.forceLogin ?
    //             this.login() :
    //             Promise.resolve({
    //                 apiKey: self.apiKey,
    //                 useruuid: self.apiKey,
    //                 tracking: self.tracking
    //             });

    //     return new Promise(function (resolve, reject) {
    //         loginPromise.then(function (loginDetails) {
    //             self.onConnect(loginDetails);
    //             options.uri = this.getAssetUrl(assetId.split('.')[0], assetId.split('.')[1]);
    //             try {
    //                 options.cookie = self.tracking;
    //                 self.httpRequest.get(options, function (err, response, data) {
    //                     if (err) {
    //                         log.error(err);
    //                         throw ({status: 500, message: 'Internal server error [0x1FQ]'});
    //                     }

    //                     resolve(data);
    //                 });
    //             } catch(err) {
    //                 if (!options.forceLogin) {
    //                     log.info('Request failed for reason: ' + err + '. Cached login information expired. Retrying with explicit login');
    //                     options.forceLogin = true;
    //                     this.makeHTTPCall(options).then(result => resolve(result)).catch(err_ => reject(err_));
    //                 } else {
    //                     log.error(err);
    //                     reject(err);
    //                 }
    //             }
    //         }
    //     ); });
    // }
}

module.exports = IntelligenceBank;
