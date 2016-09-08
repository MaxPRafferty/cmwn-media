var exports = module.exports = {};
var _ = require('lodash');
var Log = require('log');
var log = new Log();
//var config = require('./config.json');
//var env = config.env;

var AWS = require('aws-sdk');
AWS.config.loadFromPath('./src/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();

var IntelligenceBank = require('./intellignece_bank_client.js');

const IB_API_URL = 'apius.intelligencebank.com';

var transformFolderToExpected = function (folderId, data) {
    var transformed = data;
    delete transformed.folderuuid;
    /* eslint-disable camelcase */
    transformed.asset_type = 'folder';
    transformed.media_id = folderId;
    /* eslint-enable camelcase */
    transformed.type = 'folder';
    transformed.created = data.createdtime;
    delete transformed.createdtime;
    transformed.items = _.map(data.resource, function (item) {
        return transformResourceToExpected(item);
    });
    delete transformed.resource;
    transformed.items = transformed.items.concat(_.map(data.folder, function (item) {
        return transformFolderToExpected(item, item.folderuuid);
    }));
    delete transformed.folder;
};

var transformResourceToExpected = function (resourceLocationUrl, data) {
    var transformed = data;
    transformed.type = 'file';
    //no hash currently being returned. hmmmmmm
    transformed.check = {
        type: null,
        value: null
    };
    /* eslint-disable camelcase */
    transformed.media_id = data.resourceuuid;
    //nor mime type. double hmmmm
    transformed.mime_type = null;
    /* eslint-enable camelcase */
    delete transformed.resourceuuid;
    transformed.name = data.title;
    transformed.src = resourceLocationUrl + transformed.media_id;
    transformed.thumb = resourceLocationUrl + transformed.media_id + '&compressiontype=2&size=25';

    data.tags.forEach(tag => {
        if (tag.indexOf('asset_type') === 0) {
            transformed.asset_type = tag.split('-')[1]; // eslint-disable-line camelcase
        } else if (~tag.indexOf(':')) {
            transformed[tag.split(':')[0]] = tag.split(':')[1];
        } else {
            transformed[tag] = true; // eslint-disable-line camelcase
        }
    });


};

var ibClient = new IntelligenceBank({
    baseUrl: IB_API_URL,
    log: Log,
    transformFolder: transformFolderToExpected,
    transformAsset: transformResourceToExpected
});


exports.init = function () {
    'use strict';

    docClient.get({
        TableName: 'intelligence_bank_keys',
        Key: {
            'key_name': 'apikey'
        }
    }, function (err, data) {
        if (err || !Object.keys(data).length) {
            ibClient.connect({
                onConnect: function (data_) {
                    //store in dynamo
                    docClient.put({TableName: 'intelligence_bank_keys', Item: {
                        'key_name': 'apikey',
                        useruuid: data_.useruuid,
                        apikey: data_.apikey
                    }}, function (err) {
                        if (err) {
                            console.error('cache store failed: ' + err);
                        }
                    });
                }
            });
        } else {
            ibClient.connect({
                apikey: data.Item.apikey,
                useruuid: data.Item.useruuid
            });
        }
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfo = function (assetId, r) {
    if (!isNaN(parseInt(assetId, 10))) {
        getAssetInfoById(assetId, r);
    } else {
        getAssetInfoByPath(assetId, r);
    }
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAsset = function (assetId, r) {
    'use strict';

    getAssetOrFolder(assetId);

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
                        if (fileResult) {
                            log.info('We have a file');
                            if (fileResult.shared_link) {
                                r({
                                    url: fileResult.shared_link.download_url
                                });
                            } else {
                                r();
                            }
                        } else {
                            log.info('We have a folder');
                            r({ status: 421 });
                        }
                    }
                );
            });
        } else {
            r();
        }
    });

    if ('' + parseInt(assetId, 10) === assetId) {
        r2({ 'media_id': assetId });
    } else {
        getAssetInfoByPath(assetId, r2);
    }
};
