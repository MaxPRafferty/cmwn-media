'use strict';
var _ = require('lodash');
var Log = require('log');
var crypto = require('crypto');
var cliArgs = require('optimist').argv;
var log = new Log((cliArgs.d || cliArgs.debug) ? 'debug' : 'info');
var httprequest = require('request');

var config = require('../conf/config.json');
var AWS = require('aws-sdk');
AWS.config.loadFromPath('./conf/config.json');
var docClient = new AWS.DynamoDB.DocumentClient();

var rollbar = require('rollbar');

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

const MAP_CACHE_EXPIRY = config.path_map_cahce_expiry;

function md5(stringToHash) {
    var md5Hash = crypto.createHash('md5');
    md5Hash.update(stringToHash);
    return md5Hash.digest('hex');
}

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
                self.httpRequest.get(options, function (err, response, data) {
                    try {
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
                            throw {status: 404, message: 'Not Found'};
                        }

                        if (data.message === IB_ERRORS.LOGIN) {
                            throw ({status: 401, message: 'Invalid Login. User not authorized'});
                        }

                        if (data.message != null) {
                            throw ({status: 500, message: 'Internal service error: [0xEA7'});
                        }

                        log.debug('got data: ' + JSON.stringify(data));
                        resolve(data.response || data);
                    } catch(error) {
                        if (!options.forceLogin) {
                            log.info('Request failed for reason: ' + error.message + '. Cached login information expired. Retrying with explicit login');
                            options.forceLogin = true;
                            self.makeHTTPCall(options).then(result => resolve(result)).catch(err_ => reject(err_));
                        } else {
                            log.error(error);
                            reject(error);
                        }
                    }
                });
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
                if (options.id != null) {
                    qs.folderuuid = options.id;
                }
                log.info('getting folder by id at url ' + IB_PATHS.RESOURCE + '?' + JSON.stringify(qs));
                self.makeHTTPCall({
                    uri: self.baseUrl + IB_PATHS.RESOURCE,
                    qs: qs
                })
                    .then(function (data) {
                        try {
                            log.info('got folder data for folder ' + (options.id || 'root'));
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
                    .then(function (data_) {
                        resolve(data_);//no need to transform, happens in getFolderByPath
                    })
                    .catch(function (err__) {
                        log.error(err__);
                        reject(err__);
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

    storeIdPathMap(path, id, asset_type) { //eslint-disable-line camelcase
        if (path.indexOf('/') !== 0) {
            path = '/' + path;
        }
        log.info('attempting to cache path ' + path + ' at id ' + id);
        docClient.put({TableName: 'intelligence_bank_id_map', Item: {
            path: md5(config.host) + path,
            expires: Math.floor((new Date(Date.now())).getTime()) + (MAP_CACHE_EXPIRY * 24 * 60 * 60 * 1000),
            id,
            asset_type //eslint-disable-line camelcase
        }}, function (err) {
            if (err) {
                log.error('cache store failed: ' + err);
                rollbar.reportMessageWithPayloadData('Error trying to cache IB path/id map', {error: err});
            }
        });
    }

    getIdByPath(pathToMatch) {
        var self = this;
        if (pathToMatch === '/' || pathToMatch.length === 0) {
            return Promise.resolve({});
        }

        //ignore trailing slash in all instances except root, handled above
        if (pathToMatch.split('').pop() === '/') {
            pathToMatch = pathToMatch.slice(0, -1);
        }
        return new Promise((resolve, reject) => {
            var now = new Date(Date.now());
            var params = {
                TableName: 'intelligence_bank_id_map',
                Key: {
                    'path': md5(config.host) + '/' + pathToMatch
                }
            };
            log.info('checking cache for ' + md5(config.host) + '/' + pathToMatch);
            //step 1: check cache for path
            docClient.get(params, function (err, cachedOptions) {
                if (
                    !err &&
                    cachedOptions.Item &&
                    cachedOptions.Item.id != null &&
                    !global.caching.noMap &&
                    now < new Date(cachedOptions.Item.expires)
                ) {
                    console.log('cache time: ' + (new Date(cachedOptions.Item.expires) >= now));
                    log.info('found ' + pathToMatch + ' in path map cache with err ' + err + ' and options ' + JSON.stringify(cachedOptions));
                    //step 2.b it is. Resolve by ID
                    resolve(cachedOptions.Item);
                } else {
                    if (cachedOptions.Item && now >= new Date(cachedOptions.Item.expires)) {
                        log.info('cache expired for ' + pathToMatch);
                    } else {
                        log.info('path mapping cache miss for ' + pathToMatch);
                    }
                    //step 2.a it isnt
                    //step 3: slice path
                    var pathArr = pathToMatch.split('/');
                    var ownFolder = pathArr.pop();
                    //step 4: recur; pop last path item
                    self.getIdByPath(pathArr.join('/')).then(options => {
                        //step 5: get parent folder by ID
                        self.getFolderInfo(options).then(folder => {
                            var foundFolderId;
                            var assetType;
                            //looping with each instead of filter because we already have the
                            //ids, might as well store their IDs for later, regardless of if
                            //we find the folder we want
                            _.each(folder.items, function (item) {
                                if (item.name === ownFolder) {
                                    foundFolderId = item.media_id;
                                    assetType = item.asset_type === 'folder' ? 'folder' : 'file';
                                }
                                //if (item.asset_type === 'folder') {
                                self.storeIdPathMap(pathArr.join('/') + '/' + item.name, item.media_id, item.asset_type === 'folder' ? 'folder' : 'file');
                                //}
                                item.asset_type === 'folder' ? 'folder' : 'file';
                            });
                            if (foundFolderId != null) {
                                //step 5.a: path found, resolve ID
                                self.storeIdPathMap(pathToMatch || 'root', foundFolderId, assetType);
                                resolve({id: foundFolderId, asset_type: assetType}); //eslint-disable-line camelcase
                            } else {
                                //step 5.b: path does not exist
                                reject({status: 404, message: 'resource does not exist at path ' + pathToMatch});
                            }
                        }).catch(reject);
                    }).catch(reject);
                }
            });
        });
    }

    getFolderByPath(pathToMatch) {
        var self = this;
        return new Promise((resolve, reject) => {
            self.getIdByPath(pathToMatch).then(options => {
                if (options.asset_type === 'folder') {
                    self.getFolderInfo(options).then(resolve).catch(reject);
                } else {
                    self.getAssetInfo(options).then(resolve).catch(reject);
                }
            }).catch(reject);
        });
    }

    getAssetInfo(options) {
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
                }).then(function (data) {
                    try {
                        log.info('got asset data for asset ' + options.id);

                        if (!data || !data.doc || data.numFound !== '1') {
                            log.warning('No response for server information');
                            reject(data);
                        } else {
                            resolve(self.transformAsset(data.doc[0]));
                        }
                    } catch(err_) {
                        log.error('bad data recieved from server: ' + err_);
                        reject(err_);
                    }
                }).catch(function (err_) {
                    reject(err_);
                });
            } else if (options.path) {
                self.getFolderByPath(options.path)
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

    getAssetUrl(file) {
        console.log('gettin file: ' + file);
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

        if (ext == null || ext === '' || assetArray.length === 0) {
            reject({message: 'File has no extension', status: 406});
            //throw new Error('No file extension provided.');
        }

        if (assetId !== '0' && (assetId.indexOf('/') !== -1 || assetId.length !== 32)) {
            this.getIdByPath(assetId)
            .then(options => {
                var resourceUrl =
                    IB_API_ENDPOINT + IB_PATHS.RESOURCE +
                    '?p10=' + this.apiKey +
                    '&p20=' + this.useruuid +
                    '&fileuuid=' + options.id +
                    '&ext=' + ext +
                    (query ? '&' + query : '');
                log.info('trying to display image by path from ' + resourceUrl);
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
            log.info('trying to display image by id from ' + resourceUrl);
            resolve(resourceUrl);
        }

        return asset;
    }

    getTracking() {
        return this.tracking;
    }
}

module.exports = IntelligenceBank;
