var exports = module.exports = {};
var _ = require('lodash');
var Log = require('log');
var log = new Log('info');
var config = require('../conf/intelligence_bank_config.json');

var AWS = require('aws-sdk');
AWS.config.loadFromPath('./conf/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();

var IntelligenceBank = require('./intelligence_bank_client.js');

const IB_API_URL = 'https://apius.intelligencebank.com';

var transformFolderToExpected = function (resourceLocationUrl, folderId, data) {
    var transformed = data;
    transformed.items = [];
    delete transformed.folderuuid;
    /* eslint-disable camelcase */
    transformed.asset_type = 'folder';
    transformed.media_id = folderId;
    /* eslint-enable camelcase */
    transformed.type = 'folder';
    transformed.created = data.createdtime;
    delete transformed.createdtime;
    transformed.items = transformed.items.concat(_.map(data.resource || [], function (item) {
        return transformResourceToExpected(resourceLocationUrl, item);
    }));
    delete transformed.resource;
    transformed.items = transformed.items.concat(_.map(data.folder, function (item) {
        return transformFolderToExpected(resourceLocationUrl, item.folderuuid, item);
    }));
    delete transformed.folder;
    return transformed;
};

var transformResourceToExpected = function (resourceLocationUrl, data) {
    var transformed = data;
    log.info('Got resource: ' + resourceLocationUrl);
    transformed.type = 'file';
    //no hash currently being returned. hmmmmmm
    transformed.check = {
        type: null,
        value: null
    };
    /* eslint-disable camelcase */
    transformed.media_id = data.resourceuuid || data.uuid;
    //nor mime type. double hmmmm
    transformed.mime_type = null;
    /* eslint-enable camelcase */
    delete transformed.resourceuuid;
    transformed.name = data.title;
    transformed.src = resourceLocationUrl + transformed.media_id;
    transformed.thumb = resourceLocationUrl + transformed.media_id + '&compressiontype=2&size=25';

    data.tags = data.tags || [];

    data.tags.forEach(tag => {
        if (tag.indexOf('asset_type') === 0) {
            transformed.asset_type = tag.split('-')[1]; // eslint-disable-line camelcase
        } else if (~tag.indexOf(':')) {
            transformed[tag.split(':')[0].toLowerCase()] = tag.split(':')[1];
        } else {
            transformed[tag.toLowerCase()] = true; // eslint-disable-line camelcase
        }
    });

    //DynamoDB is apparently out of their damn mind and doesn't allow empty
    // strings in their database.
    // MAX - If you pay to see my nomad PHP talk Tomorrow,
    // I will go over why dynamo cannot have empty values - MC
    transformed = _.reduce(transformed, function (a, v, k) {
        if (v !== '') {
            a[k] = v;
        }
        return a;
    }, {});
    delete transformed.versions;

    return transformed;
};

var ibClient = new IntelligenceBank({
    baseUrl: IB_API_URL,
    userName: config.userName,
    password: config.password,
    platformUrl: config.platformUrl,
    //log: Log,
    transformFolder: transformFolderToExpected,
    transformAsset: transformResourceToExpected,
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
            log.info('manually retrieving keys');
            ibClient.connect({
                username: config.username,
                password: config.password,
                instanceUrl: config.instanceUrl,
                ownUrl: config.host,
                onConnect: function (data_) {
                    //store in dynamo
                    docClient.put({TableName: 'intelligence_bank_keys', Item: {
                        'key_name': 'apikey',
                        useruuid: data_.useruuid,
                        apikey: data_.apikey
                    }}, function (err_) {
                        if (err_) {
                            log.warn('cache store failed: ' + err_);
                        }
                    });
                }
            });
        } else {
            log.info('retrieving stored key');
            ibClient.connect({
                apikey: data.Item.apikey,
                useruuid: data.Item.useruuid,
                instanceUrl: config.instanceUrl,
                ownUrl: config.host,
            });
        }
    });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAssetInfo = function (assetId, resolve, reject) {
    var requestData = {};
    if (assetId != null && assetId !== 0 && assetId !== '0' && assetId !== '') {
        requestData.id = assetId;
    }
    //we do not know at this point if we have a folder or an asset. The only way to know
    //is to check both. One call will always fail, one will always succeed.

    var success = function (data_) {
        log.info('here 8000');
        data_.id = data_.media_id || data_.uuid;
        resolve(data_);
    };

    ibClient.getAssetInfo(requestData)
        .then(success)
        .catch(function (assetError) {
            log.error('error when requesting asset information', assetError);
            ibClient.getFolderInfo(requestData)
                .then(success)
                .catch(function (folderError) {
                    log.error('error when requesting folder information', folderError);
                    reject('ERROR: 500. Details: ' + folderError);
                });
        });
};

/*
 * @param assetId (string) the id of the file or folder to find
 * @param r (function) the function the calls the resolve for the Promise
 */
exports.getAsset = function (assetId, r) {
    'use strict';
    r({url: ibClient.getAssetUrl(assetId)});
};
