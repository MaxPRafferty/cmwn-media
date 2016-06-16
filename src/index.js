var express = require('express');
var app = express();
// var path = require('path');
// var fs = require('fs');
// var http = require('http');
var request = require('request');
var service = require('./boxService.js');

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    console.log(req.url);
    console.log(req.params);

    var assetId = req.params[0];
    console.log('Asset Id: ' + assetId);

    if (assetId === undefined) {
        console.log('No Asset requested returning page');
        var page = req.query.page || 1;
        var perPage = req.query.per_page || 10;

        res.send(service.getPage('/f/', page, perPage));
        return;
    }

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        res.send(data);
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
    console.log(req.url);
    console.log(req.params);

    var assetId = req.params[0];
    console.log('Asset Id: ' + assetId);

    if (assetId === undefined) {
        console.log('No Asset requested returning page');
        var page = req.query.page || 1;
        var perPage = req.query.per_page || 10;

        res.send(service.getPage('/f/', page, perPage));
        return;
    }

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        if (data.url) {
            request({url: data.url, encoding: null}, function (err, ires, body) {
                if (!err && ires.statusCode === 200) {
                    res.send(body);
                } else {
                    res.send('Image cannot be found.');
                }
            });
        }
    });

    if ('' + parseInt(assetId, 10) === assetId) {
        service.getAssetInfo(assetId, r);
    } else {
        service.getAssetInfoByPath(assetId, r);
    }
});

app.listen(3000, function () {
    console.log('Example app listening on port 3000!');
});
