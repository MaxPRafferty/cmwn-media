var exports = module.exports = {};
var Log = require('log');
var log = new Log();
var boxSDK = require('box-sdk');
var config = require('./config.json');
var env = config.env;

//Default host: localhost
var box = boxSDK.Box({
    'client_id': config.client_id,
    'client_secret': config.client_secret,
    'port': 9999,
    'host': config.host || 'localhost'
}, config.logLevel);

var connection = box.getConnection(config.client_email);

function getItemObject(item) {
    'use strict';
    var obj;

    if (!item) {
        return;
    }

    obj = {
        type: item.type,
        id: item.id,
        name: item.name,
        tags: item.tags
    };

    if (item.type === 'file' && item.shared_link) {
        obj.url = item.shared_link.download_url;
    }

    if (item.item_collection) {
        obj.items = item.item_collection.entries.map(function (i) {
            return getItemObject(i);
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
 * @param query (string) the query string to search
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfoByPath = function (query, r) {
    'use strict';

    query = query || '';

    log.debug('Finding Asset by Path: ' + query);
    //Navigate user to the auth URL
    connection.ready(function () {
        log.debug('ready getAssetInfoByPath');
        connection.search(
            query,
            null,
            function (err, result) {
                log.debug('getAssetInfoByPath');
                if (err) {
                    log.error(JSON.stringify(err.context_info));
                    r();
                }

                var path = query.split('/');
                var name = path[path.length - 1];

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
exports.getAssetInfo = function (assetId, r) {
    'use strict';

    assetId = assetId || 0;

    log.debug('Finding Asset: ' + assetId);

    //Navigate user to the auth URL
    connection.ready(function () {
        log.debug('getAssetInfo Ready');
        connection.getFileInfo(
            assetId + '?fields=type,id,name,shared_link,tags',
            function (fileErr, fileResult) {
                if (fileErr) {
                    log.error(fileErr);
                    r();
                    return;
                }

                if (fileResult) {
                    log.info('We have a file');
                    let fileObj = getItemObject(fileResult);
                    r(fileObj);
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
                                let folderObj = getItemObject(folderResult);
                                r(folderObj);
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

    assetId = assetId || 0;

    log.debug('Getting Asset: ' + assetId);

    //Navigate user to the auth URL
    connection.ready(function () {
        connection.getFile(
            assetId,
            null,
            null,
            function (fileErr, fileResult) {
                if (fileErr) {
                    console.error(JSON.stringify(fileErr.context_info));
                    r();
                }

                if (fileResult) {
                    log.debug('found it');
                    r(fileResult);
                } else {
                    log.debug('didnt find it');
                    connection.getFolderInfo(
                        assetId,
                        function (folderErr, folderResult) {
                            if (folderErr) {
                                console.error(JSON.stringify(folderErr.context_info));
                            }

                            if (folderResult) {
                                let folderObj = getItemObject(folderResult);
                                r(folderObj);
                            }
                        }
                    );
                }
            }
        );
    });
};
