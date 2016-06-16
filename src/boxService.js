console.log('Loading xml');
var exports = module.exports = {};

var boxSDK = require('box-sdk');

var logLevel = 'debug'; //default log level on construction is info

//Default host: localhost
var box = boxSDK.Box({
    'client_id': 'skhyf94wbjwcx0ax35b83mnwq01xtvrp',
    'client_secret': 'LRO7OVEGYd1qnjeU6BbobvLl29DvJGWr',
    port: 9999,
    // host: 'somehost' //default localhost
}, logLevel);

function getItemObject(item) {
    if (!item) {
        return;
    }

    if (item.type === 'file') {
        return {
            type: item.type,
            id: item.id,
            name: item.name,
            url: item.shared_link ? item.shared_link.download_url : ''
        };
    }

    return {
        type: item.type,
        id: item.id,
        name: item.name,
        items: item.item_collection ? item.item_collection.entries : []
    };
}

exports.getAssetInfoByPath = function (query, r) {
    'use strict';

    query = query || '';

    console.log('Finding Asset by Path: ' + query);

    var connection = box.getConnection('admin@changemyworldnow.com');

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
                }

                var path = query.split('/');
                var name = path[path.length - 1];

                if (result.entries) {
                    var entries = result.entries.filter(function (entry) {
                        return entry.name === name;
                    });

                    if (!entries.length) {
                        r(null);
                    } else if (entries.length === 1) {
                        console.dir(entries[0]);

                        if (entries[0].type === 'folder') {
                            exports.getAssetInfo(entries[0].id, r);
                        } else {
                            r(getItemObject(entries[0]));
                        }
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

                        if (entries[0].type === 'folder') {
                            exports.getAssetInfo(entries[0].id, r);
                        } else {
                            r(getItemObject(entries[0]));
                        }
                    }
                }
            }
        );
    });
};

exports.getAssetInfo = function (assetId, r) {
    'use strict';

    assetId = assetId || 0;

    console.log('Finding Asset: ' + assetId);
    // var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);

    var connection = box.getConnection('admin@changemyworldnow.com');

    //Navigate user to the auth URL
    console.log(connection.getAuthURL());

    connection.ready(function () {
        connection.getFileInfo(
            assetId,
            function (fileErr, fileResult) {
                if (fileErr) {
                    console.error(JSON.stringify(fileErr.context_info));
                }

                if (fileResult) {
                    let fileObj = getItemObject(fileResult);

                    console.dir(fileObj);
                    r(fileObj);
                    // r(fileResult);
                } else {
                    connection.getFolderInfo(
                        assetId,
                        function (folderErr, folderResult) {
                            if (folderErr) {
                                console.error(JSON.stringify(folderErr.context_info));
                            }

                            if (folderResult) {
                                let folderObj = getItemObject(folderResult);

                                console.dir(folderObj);
                                r(folderObj);
                            }
                        }
                    );
                }
            }
        );
    });
};

exports.getAsset = function (assetId, r) {
    'use strict';

    assetId = assetId || 0;

    console.log('Getting Asset: ' + assetId);
    // var results = xpath.select('//item/asset_id[text()="' + assetId + '"]', doc);

    var connection = box.getConnection('admin@changemyworldnow.com');

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

                                console.dir(folderObj);
                                r(folderObj);
                            }
                        }
                    );
                }
            }
        );
    });
};
