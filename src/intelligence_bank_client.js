var _ = 'lodash';
var httprequest = require('request');

const IB_PATHS = {
    LOGIN: '/webapp/1.0/login',
    RESOURCE: '/webapp/1.0/resources'
};

const IB_SILLY_ERROR = 'A server error ocurred';


class IntelligenceBank {
    constructor(options) {
        this.apikey = '';
        this.useruuid = '';
        this.request = httprequest.defaults({
            baseUrl: options.baseUrl,
            method: 'GET',
            json: true
        });
        this.log = options.log || console;
        this.transformFolder = options.transformFolder;
        this.transformAsset = options.transformAsset;
    }
    makeHTTPCall(options) {
        return new Promise(function (resolve, reject) {
            this.request(options, function (err, response, data) {
                if (err) {
                    this.log.error(err);
                    reject(err);
                } else if (data.message === IB_SILLY_ERROR) {
                    reject({message: 'server refused request, reason not provided. 404 assumed.', status: 404});
                } else {
                    this.log.log(data);
                    resolve(data);
                }
            });
        });
    }
    connect(options) {
        var defaultOptions = {
            onConnect: _.identity
        };
        var formData = {
            p70: options.username,
            p80: options.password,
            p90: options.instanceUrl
        };
        var requestParams = {
            method: 'POST',
            uri: IB_PATHS.LOGIN,
            form: formData
        };

        options = _.defaults(options, defaultOptions);

        this.transformAsset = this.transformAsset.bind(
                null,
                options.instanceUrl + IB_PATHS.RESOURCE +
                    '?p10=' + this.apikey +
                    '&p20=' + this.useruuid +
                    '&fileuuid='
        );

        return this.makeHTTPCall(requestParams).then(function (data) {
            options.onConnect(data);
            this.apikey = data.apikey;
            this.useruuid = data.useruuid;
            return Promise.resolve(data);
        });
    }
    getFolderInfo(options) {
        var resolve;
        var reject;
        var err;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        //very simple. If an id is provided, retrieve it directly. If a path is provided, walk the tree until it is found
        if (options.id) {
            this.makeHTTPCall({qs: {
                p10: this.apikey,
                p20: this.useruuid,
                folderuuid: options.id
            }})
                .then(function (data) {
                    resolve(this.transformFolder(data));
                })
                .catch(function (err_) {
                    reject(err_);
                });
        } else if (options.path) {
            this.getFolderByPath(options.path)
                .then(function (data) {
                    resolve(data);//no need to transform, happens in getFolderByPath
                })
                .catch(function (err_) {
                    this.log.error(err_);
                    reject(err_);
                });
        } else {
            err = 'No ID or path provided. Folder cannot be retrieved. Options passed: ' + JSON.stringify(options);
            this.log.error(err);
            reject(err);
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
    getFolderByPath(pathToMatch, currentPath = '', currentFolderId = '') {
        var resolve;
        var reject;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        var options = {qs: {
            p10: this.apikey,
            p20: this.useruuid,
            folderuuid: currentFolderId
        }};
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
    /**
     * getAssetInfo
     * There is some definite weirdness with the IB API. Namely, they seem to hate returning identities.
     * As a result, asset information can only be retrieved by accessing the folder it belongs to.
     * As of my current understanding of their API, only raw assets can be retrieved by direct ID.
     * What this means, is that regardless of whether of not we are looking an asset up by ID or Path,
     * we need to traverse the entire folder tree in search of it.
     * While this is fine for now, if there is ANY sort of pagination this will likely become unsustainable
     * At that point, we will need to write a cron job to just walk the tree, and prime the cache with all
     * images nightly.
     */
    getAssetInfo(options) {
        this.getAssetFromTree(options);
    }
    getAssetFromTree(targetOptions, currentPath = '', currentFolderId = '') {
        var resolve;
        var reject;
        var folder = new Promise(function (resolve_, reject_) {
            resolve = resolve_;
            reject = reject_;
        });
        var options = {qs: {
            p10: this.apikey,
            p20: this.useruuid,
            folderuuid: currentFolderId
        }};
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
}

module.exports = IntelligenceBank;
