var Log = require('log');
var log = new Log('info');
var express = require('express');
var app = express();
var request = require('request');
var service = require('./boxService.js');
var storage = require('./storage.js');

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    log.debug(req.url);
    log.debug(req.params);

    var assetId = req.params[0] || '0';
    log.debug('Asset Id: ' + assetId);

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        if (data) {
            res.send(data);
        } else {
            res.status(404).send('Not Found');
        }
    });

    if ('' + parseInt(assetId, 10) === assetId) {
        service.getAssetInfo(assetId, r);
    } else {
        service.getAssetInfoByPath(assetId, r);
    }
});

// Serve the asset
app.get('/f/*', function (req, res) {
    'use strict';
    log.debug(req.url);
    log.debug(req.params);

    var assetId = req.params[0] || '0';
    log.debug('Asset Id: ' + assetId);

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        if (data.src) {
            request({url: data.src, encoding: null}, function (err, ires, body) {
                if (!err && ires.statusCode === 200) {
                    res.send(body);
                } else {
                    res.status(404).send('Not Found');
                }
            });
        } else {
            res.status(404).send('Not Found');
        }
    });

    if ('' + parseInt(assetId, 10) === assetId) {
        service.getAssetInfo(assetId, r);
    } else {
        service.getAssetInfoByPath(assetId, r);
    }
});

app.listen(3000, function () {
    service.init(storage);
    log.debug('Example app listening on port 3000!');
});
