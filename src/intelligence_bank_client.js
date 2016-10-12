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
    constructor(options) {
        this.userName = options.userName || null;
        this.password = options.password || null;
        this.platformUrl = options.platformUrl || null;

        if (this.userName === null) {
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
        this.apikey = '';
        this.useruuid = '';
        this.baseUrl = options.baseUrl;
        this.httpRequest = httprequest.defaults({
            json: true,
            jar: true
        });
        this.transformFolder = options.transformFolder;
        this.transformAsset = options.transformAsset;
    }

    login(resolve, reject) {
        let self = this;
        let loginOptions = {
            'url': IB_API_ENDPOINT + IB_PATHS.LOGIN,
            'form': {
                'p70': this.userName,
                'p80': this.password,
                'p90': this.platformUrl
            }
        };

        this.httpRequest.post(loginOptions, function (err, response, data) {
            if (err) {
                log.error(err);
                reject({status: 500, message: 'Internal server error [0x1F4]'});
                return;
            }

            if ([200].indexOf(response.statusCode) === -1) {
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

            self.apiKey = data.apikey;
            self.useruuid = data.useruuid;
            log.info('Login successful');
            resolve();
        });
    }

    makeHTTPCall(options) {
        var self = this;
        return new Promise(function (resolve, reject) {
            self.login(function () {
                options.qs = options.qs || {};
                options.qs.p10 = self.apiKey;
                options.qs.p20 = self.useruuid;
                try {
                    self.httpRequest.get(options, function (err, response, data) {
                        if (err) {
                            log.error(err);
                            reject({status: 500, message: 'Internal server error [0x1F5]'});
                            return;
                        }

                        if ([200].indexOf(response.statusCode) === -1) {
                            log.error('Invalid response code', response);
                            reject({status: 500, message: 'Internal server error [0x1F2]'});
                            return;
                        }

                        if (data.message === IB_ERRORS.SILLY) {
                            log.error('', data);
                            reject({status: 404, message: 'Not Found'});
                            return;
                        }

                        if (data.message === IB_ERRORS.LOGIN) {
                            reject({status: 401, message: 'Invalid Login. User not authorized'});
                            return;
                        }

                        log.info(data);
                        resolve(data.response);
                    });
                } catch(err) {
                    log.error(err);
                    reject(err);
                }
            }, reject);
        });
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

                            if (!data.response) {
                                log.warning('No response for folder information');
                                reject({status: 404, message: 'Not Found'});
                            } else {
                                resolve(self.transformFolder(options.id, data.response));
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
    getFolderByPath(pathToMatch, currentPath, currentFolderId) {
        log.info('getting folder by path');
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
                _.each(data.response.folder, function (item) {
                    //we are being naughty and using side effects of this transformation for
                    //caching purposes, hence why we are calling it all the time.
                    var transformedFolder = this.transformFolder(item);
                    if (currentPath + item.name === pathToMatch) {
                        resolve(transformedFolder);
                    } else {
                        this.getFolderByPath(pathToMatch, currentPath + item.name, item.folderuuid)
                            .then(function (data_) {
                                resolve(data_); //again, no need to double transform
                            })
                            .catch(function () {
                                foldersSearched++;
                                if (foldersSearched === data.response.folder.length) {
                                    reject('folder does not exist in subtree path ' + currentPath + item.name);
                                }
                            });
                    }
                });
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
        log.info('getting asset with apikey: ' + self.apikey);
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
                    this.transformFolder(item);
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
    getAssetUrl(assetId) {
        var resourceUrl =
            IB_API_ENDPOINT + IB_PATHS.RESOURCE +
            '?p10=' + this.apikey +
            '&p20=' + this.useruuid +
            '&fileuuid=' + assetId.replace('?', '&');
        log.info('trying to display image from ' + resourceUrl);
        return resourceUrl;
    }
}

module.exports = IntelligenceBank;
