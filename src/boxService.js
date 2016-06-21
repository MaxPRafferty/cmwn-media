console.log('Loading xml');
var exports = module.exports = {};

var boxSDK = require('box-sdk');
var config = require('./config.json');

//Default host: localhost
var box = boxSDK.Box({
    'client_id': config.client_id,
    'client_secret': config.client_secret,
    port: 9999,
    // host: 'somehost' //default localhost
}, config.logLevel);

function getItemObject(item) {
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

/*
 * @param query (string) the query string to search
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfoByPath = function (query, r) {
    'use strict';

    query = query || '';

    console.log('Finding Asset by Path: ' + query);

    var connection = box.getConnection(config.client_email);

    //Navigate user to the auth URL
    console.log(connection.getAuthURL());

    connection.ready(function () {
        console.log('ready');
        connection.search(
            query,
            null,
            function (err, result) {
                console.log('getFolderItems');
                if (err) {
                    console.error(JSON.stringify(err.context_info));
                    r();
                }

                var path = query.split('/');
                var name = path[path.length - 1];

                if (result.entries) {
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

                        console.dir(entries[0]);

                        exports.getAssetInfo(entries[0].id, r);
                    }
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

    console.log('Finding Asset: ' + assetId);
    // var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);

    var connection = box.getConnection(config.client_email);

    //Navigate user to the auth URL
    console.log(connection.getAuthURL());

    connection.ready(function () {
        connection.getFileInfo(
            assetId + '?fields=type,id,name,shared_link,tags',
            function (fileErr, fileResult) {
                if (fileResult) {
                    let fileObj = getItemObject(fileResult);

                    console.dir(fileObj);
                    r(fileObj);
                } else {
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

    console.log('Getting Asset: ' + assetId);
    // var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);

    var connection = box.getConnection(config.client_email);

    //Navigate user to the auth URL
    console.log(connection.getAuthURL());

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
                    console.log('found it');
                    r(fileResult);
                } else {
                    console.log('didnt find it');
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
