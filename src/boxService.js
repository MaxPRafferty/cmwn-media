var exports = module.exports = {};
var _ = require('lodash');
var Log = require('log');
var log = new Log();
var boxSDK = require('box-sdk');
var config = require('./config.json');
var env = config.env;
var request = require('request');
var rollbar = require('rollbar');

const THUMB_PREFIX = 'thumb_';

//Default host: localhost
var box = boxSDK.Box({
    'client_id': config.client_id,
    'client_secret': config.client_secret,
    'port': 9999,
    'host': config.host || 'localhost'
}, config.logLevel);

var connection = box.getConnection(config.client_email);

function getItemObject(item, r) {
    'use strict';
    var callResolve, obj, tags, waitOn = 0;

    if (!item) {
        return r();
    }

    callResolve = function () {
        if (!waitOn) {
            r(obj);
        } else {
            setTimeout(callResolve, 250);
        }
    };

    obj = {
        type: item.type,
        'media_id': item.id,
        name: item.name,
        'can_overlap': false,
    };

    if (item.type === 'file') {
        obj.asset_type = 'item'; // eslint-disable-line camelcase
        obj.check = {
            type: 'sha1',
            value: item.sha1
        };
        obj.src = config.hostname + '/f/' + item.id;

        if (item.shared_link) {
            waitOn++;

            request(item.shared_link.download_url, {method: 'HEAD'}, function (err, res){
                obj.mime_type = res.headers['content-type']; // eslint-disable-line camelcase
                waitOn--;
            });
        }

        tags = item.tags || [];

        tags.forEach(tag => {
            if (tag.indexOf('asset_type') === 0) {
                obj.asset_type = tag.split('-')[1]; // eslint-disable-line camelcase
            } else if (~tag.indexOf(':')) {
                obj[tag.split(':')[0].toLowerCase()] = tag.split(':')[1];
            } else {
                obj[tag.toLowerCase()] = true; // eslint-disable-line camelcase
            }
        });
    } else {
        obj.asset_type = 'folder'; // eslint-disable-line camelcase
    }

    if (item.item_collection) {
        obj.items = _.filter(_.values(_.reduce(item.item_collection.entries, function (a, v, k) {
            var fullItem = getChildItemObject(v);
            //NOTE, MPR: We have made our filenames non case sensitive. Use caution.
            var itemName = v.name.replace(THUMB_PREFIX, '').toLowerCase();
            if (v.name.indexOf(THUMB_PREFIX) === 0) {
                a[itemName] = _.defaults(
                    {},
                    {thumb: fullItem.src},
                    a[itemName]
                    //fullItem
                );
            } else {
                a[itemName] = _.defaults(
                    {},
                    fullItem,
                    a[itemName],
                    {thumb: fullItem.src, order: fullItem.order || k + item.item_collection.entries.length + 1}
                );
            }
            return a;
        }, {})), function (i) {
            return (i.type === 'file' && i.src != null) || i.type != null;
        });
    }

    callResolve();
}

function getChildItemObject(item) {
    'use strict';
    var obj, tags;

    if (!item) {
        return;
    }

    obj = {
        type: item.type,
        'media_id': item.id,
        name: item.name,
        'can_overlap': false,
        tags
    };

    if (item.type === 'file') {
        obj.asset_type = 'item'; // eslint-disable-line camelcase
        obj.check = {
            type: 'sha1',
            value: item.sha1
        };
        obj.src = config.hostname + '/f/' + item.id;

        tags = item.tags || [];

        tags.forEach(tag => {
            if (tag.indexOf('asset_type') === 0) {
                obj.asset_type = tag.split('-')[1]; // eslint-disable-line camelcase
            } else if (~tag.indexOf(':')) {
                obj[tag.split(':')[0].toLowerCase()] = tag.split(':')[1];
            } else {
                obj[tag.toLowerCase()] = true; // eslint-disable-line camelcase
            }
        });
    } else {
        obj.asset_type = 'folder'; // eslint-disable-line camelcase
    }

    if (item.item_collection) {
        obj.items = item.item_collection.entries.map(function (i) {
            return getChildItemObject(i);
        });
    }

    return obj;
}

exports.init = function (storage) {
    'use strict';

    connection.on('tokens.set', function () {
        var saveData = {
            'access_token': connection.access_token,
            'expires_in': connection.expires_in,
            'restricted_to': connection.restricted_to,
            'refresh_token': connection.refresh_token,
            'token_type': connection.token_type
        };

        log.info(saveData);
        log.debug('Saving tokens to the database');
        storage.save(env, saveData, function (err, data) {
            if (err) {
                console.error('Unable to add item. Error JSON:', JSON.stringify(err, null, 2));
            } else {
                log.debug('Added item:', JSON.stringify(data, null, 2));
            }
        });
    });

    storage.load(env, function (err, data) {
        if (err) {
            console.error('Unable to read item. Error JSON:', JSON.stringify(err, null, 2));
            return ;
        }

        var itemData = data.Item || {};
        var oauthData = itemData.data || {};

        if (oauthData.refresh_token === undefined) {  // eslint-disable-line unresolved
            log.debug('No refresh token set');
            log.info('Please Authenticate to box Api: ', connection.getAuthURL());
            return;
        }

        log.debug('Loaded existing tokens', oauthData);
        connection._setTokens(oauthData);
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfo = function (assetId, r) {
    if ('' + parseInt(assetId, 10) === assetId) {
        getAssetInfoById(assetId, r);
    } else {
        getAssetInfoByPath(assetId, r);
    }
};

/*
 * @param query (string) the query string to search
 * @param r (function) the function the calls the resolve for the Promise
 */
var getAssetInfoByPath = function (query, r) {
    'use strict';

    query = query || '';

    var path = query.split('/');
    var name = path[path.length - 1];

    log.debug('Finding Asset by Path: ' + query);
    //Navigate user to the auth URL
    connection.ready(function () {
        log.debug('ready getAssetInfoByPath');
        connection.search(
            name,
            null,
            function (err, result) {
                log.debug('getAssetInfoByPath');
                if (err) {
                    log.error(JSON.stringify(err.context_info));
                    r();
                }

                if (result && result.entries) {
                    log.info('Data found for search');
                    var entries = result.entries.filter(function (entry) {
                        return entry.name === name;
                    });

                    if (!entries.length) {
                        r();
                    } else if (entries.length === 1) {
                        exports.getAssetInfo(entries[0].id, r);
                    } else {
                        entries = entries.filter(function (entry) {
                            var pathCollection = entry.path_collection.entries.map(function (item) {
                                return item.name;
                            });
                            for (let i = 0, n = path.length - 1; i < n; i++) {
                                if (pathCollection.indexOf(path[i]) === -1) {
                                    return false;
                                }
                            }
                            return true;
                        });

                        log.info(entries[0]);
                        exports.getAssetInfo(entries[0].id, r);
                    }
                } else {
                    log.debug('No Results found');
                }
            }
        );
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
var getAssetInfoById = function (assetId, r) {
    'use strict';

    assetId = assetId || 0;

    log.debug('Finding Asset: ' + assetId);

    //Navigate user to the auth URL
    connection.ready(function () {
        log.debug('getAssetInfo Ready');
        connection.getFileInfo(
            assetId + '?fields=type,id,name,shared_link,tags,sha1',
            function (fileErr, fileResult) {
                if (fileResult) {
                    log.info('We have a file');
                    log.debug(fileResult);
                    getItemObject(fileResult, r);
                } else {
                    log.info('We have a folder');
                    connection.getFolderInfo(
                        assetId + '?fields=type,id,name,item_collection,tags',
                        function (folderErr, folderResult) {
                            if (folderErr) {
                                console.error(JSON.stringify(folderErr.context_info));
                                r();
                            }

                            if (folderResult) {
                                getItemObject(folderResult, r);
                            }
                        }
                    );
                }
            }
        );
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAsset = function (assetId, r) {
    'use strict';

    var r2;
    var p2 = new Promise(resolve => {
        r2 = data => {
            resolve(data);
        };
    });

    p2.then(data => {
        if (data) {
            connection.ready(function () {
                log.debug('getAsset Ready');
                connection.getFileInfo(
                    data.media_id + '?fields=shared_link',
                    function (fileErr, fileResult) {
                        log.error(fileErr);
                        if (fileResult) {
                            log.info('We have a file');
                            if (fileResult.shared_link) {
                                r({
                                    url: fileResult.shared_link.download_url
                                });
                            } else {
                                // todo throw an exception to avoid caching this asset that is not shared
                                log.info('Asset has no shared_link');
                                r({status: 403});
                            }
                        } else {
                            log.info('We have a folder');
                            r({ status: 421 });
                        }
                    }
                );
            });
        } else {
            log.info('HERE 3');
            r({status: 602});
        }
    }).catch(err => {
        log.info(err);
        rollbar.reportMessageWithPayloadData(
            'Error fetching asset',
            err
        );
        r({status: 500});
    });

    if ('' + parseInt(assetId, 10) === assetId) {
        r2({ 'media_id': assetId });
    } else {
        getAssetInfoByPath(assetId, r2);
    }
};
