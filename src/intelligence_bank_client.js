'use strict';
var _ = require('lodash');
var httprequest = require('request');
httprequest.debug = true;
require('request-debug')(httprequest);

const IB_API_ENDPOINT = 'https://apius.intelligencebank.com';

const IB_PATHS = {
    LOGIN: '/webapp/1.0/login',
    RESOURCE: '/webapp/1.0/resources',
    SEARCH: '/webapp/1.0/search'
};

const IB_ERRORS = {
    SILLY: 'A server error ocurred',
    LOGIN: 'Invalid user or password'
};

class IntelligenceBank {
    constructor(options) {
        this.apikey = '';
        this.useruuid = '';
        this.baseUrl = options.baseUrl;
        this.request = httprequest.defaults({
            json: true,
            /* MPR: I do not know why this cookie must be set. But this cookie must be set. */
            headers: {
                Cookie: '_aid=18ec5caaa73230298b5bc42aab395d50_cgfrj9dg4n3nbehbeal4r6sqo2;'
            }
        });
        this.log = options.log || console;
        this.transformFolder = options.transformFolder;
        this.transformAsset = options.transformAsset;
    }
    makeHTTPCall(options) {
        var self = this;
        console.log('starting http request');
        return new Promise(function (resolve, reject) {
            console.log('making http request to ' + options.uri);
            try {
                self.request(options, function (err, response, data) {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else if (data.message === IB_ERRORS.SILLY) {
                        reject({message: 'server refused request, reason not provided. 404 assumed.', status: 404});
                    } else if (data.message === IB_ERRORS.LOGIN) {
                        reject({status: 401, message: 'Invalid Login. User not authorized'});
                    } else {
                        console.log(data);
                        resolve(data);
                    }
                });
            } catch(err) {
                console.log(err);
                reject(err);
            }
        });
    }
    connect(options) {
        var self = this;
        var defaultOptions = {
            onConnect: _.identity,
            ownUrl: 'https://media.changemyworldnow.com'
        };
        var formData = {
            p70: options.username,
            p80: options.password,
            p90: options.instanceUrl
        };
        console.log('logging in as ' + JSON.stringify(options.username) + ' at ' + options.ownUrl);
        var requestParams = {
            method: 'POST',
            uri: self.baseUrl + IB_PATHS.LOGIN,
            form: formData
        };

        options = _.defaults(options, defaultOptions);

        self.ownUrl = options.ownUrl;

        if (options.apikey != null) {
            self.apikey = options.apikey;
            self.useruuid = options.useruuid;
            console.log('connection success (cache). setting keys');
            return Promise.resolve(options);
        }

        console.log('starting connect');
        return self.makeHTTPCall(requestParams)
            .then(function (data) {
                var resourceUrl = self.ownUrl + 'f/';
                options.onConnect(data);
                self.apikey = data.apikey;
                self.useruuid = data.useruuid;
                console.log('guhh' + self.apikey);
                console.log('setting key: ' + data.apikey);
                self.transformAsset = self.transformAsset.bind(null, resourceUrl);
                self.transformFolder = self.transformFolder.bind(null, resourceUrl);
                console.log('connection success. setting keys');
                return Promise.resolve(data);
            })
            .catch(function (err) {
                console.log(err);
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
        console.log('getting folder with apikey: ' + self.apikey);
        //very simple. If an id is provided, retrieve it directly. If a path is provided, walk the tree until it is found
        try {
            if (options.id) {
                console.log('getting folder by id');
                self.makeHTTPCall({
                    uri: self.baseUrl + IB_PATHS.RESOURCE,
                    qs: {
                        p10: self.apikey,
                        p20: self.useruuid,
                        folderuuid: options.id
                    }
                })
                    .then(function (data) {
                        try {
                            console.log('got folder data: ' + data.response);

                            if (!data.response) {
                                console.log('server returned no items');
                                reject(data);
                            }
                            resolve(self.transformFolder(options.id, data.response));
                        } catch(err_) {
                            console.log('bad data recieved from server: ' + err_);
                            reject(err_);
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
                        self.log.error(err_);
                        reject(err_);
                    });
            } else {
                err = 'No ID or path provided. Folder cannot be retrieved. Options passed: ' + JSON.stringify(options);
                self.log.error(err);
                reject(err);
            }
        } catch(err_) {
            console.log('unknown error: ' + err_);
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
        console.log('getting folder by path');
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
                p10: this.apikey,
                p20: this.useruuid,
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
                this.log.error(err);
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
        console.log('getting asset with apikey: ' + self.apikey);
        //very simple. If an id is provided, retrieve it directly. If a path is provided, walk the tree until it is found
        try {
            if (options.id) {
                console.log('getting asset by id');
                self.makeHTTPCall({
                    uri: self.baseUrl + IB_PATHS.SEARCH,
                    qs: {
                        p10: self.apikey,
                        p20: self.useruuid,
                        searchterm: options.id
                    }
                })
                    .then(function (data) {
                        try {
                            console.log('got asset data: ' + data.response);

                            if (!data.doc || data.numFound !== '1') {
                                console.log('server returned no items');
                                reject(data);
                            }
                            resolve(self.transformAsset(data.doc[0]));
                        } catch(err_) {
                            console.log('bad data recieved from server: ' + err_);
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
                        self.log.error(err_);
                        reject(err_);
                    });
            } else {
                err = 'No ID or path provided. Asset cannot be retrieved. Options passed: ' + JSON.stringify(options);
                self.log.error(err);
                reject(err);
            }
        } catch(err_) {
            console.log('unknown error: ' + err_);
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
                p10: this.apikey,
                p20: this.useruuid,
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
                this.log.error(err);
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
        console.log('trying to display image from ' + resourceUrl);
        return resourceUrl;
    }
}

module.exports = IntelligenceBank;
