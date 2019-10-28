/*
 * Handles all communication with zone / metjm
 * Handles all communication with background thread
 * Checks whether or not user is logged in
 */
define(["csgozone", "core/metjm", "util/constants", "util/util",
       "port!BACKGROUND_GET_TOKEN", 
       "port!BACKGROUND_GET_PLUGIN_STATUS", 
       "port!BACKGROUND_GET_STORAGE, namespace: screenshot",
       "port!BACKGROUND_GET_STORAGE, namespace: marketinspect"],
    function(csgozone, metjm, constants, util,
             token_msg, plugin_status, screenshot_storage, inspect_storage) {

    "using strict";
    /* list of functions to be called after we finish initializing */
    var onReadyList = [];

    /* list of functions to be called on events */
    var eventListeners = [];

    /* is the plugin enabled or disabled */
    var isEnabled = plugin_status.status;

    /* did we finish initialization or not */
    var isReady = false;

    /* do we have a valid token or not */
    var isLoggedIn = false;

    /* api token */
    var token = token_msg.token;

    /* our local storage */
    var storage = {};
    
    /* version of the extension returned by background */
    var version = plugin_status.version;

    /* name must not include "_" */
    var NAMESPACE_SCREENSHOT     = constants.namespace.NAMESPACE_SCREENSHOT;
    var NAMESPACE_MARKET_INSPECT = constants.namespace.NAMESPACE_MARKET_INSPECT;

    /* port to backend */
    var port = chrome.runtime.connect({name: 'steamwizrd'});        

    function parseToken(token) {
        try {
            return JSON.parse(atob(token));
        } catch(e) {
            return null;
        }
    }

    function validateToken(token) {
        if(token == null)
           return false;

        var json = parseToken(token);

        if(json === null || json.timestamp === undefined || new Date().getTime() - json.timestamp > 2 * 24 * 60 * 60 * 1000)
           return false;

        return true;
    }

    function loginCallback(response) {
        if(response.success === true) {
           token = response.token;
           port.postMessage({msg: constants.msg.BACKGROUND_SET_TOKEN, token: response.token});
        }
    }

    function processLogin() {
        /* make sure both services are enabled */
        if(token !== null) {
           csgozone.setToken(token);
           metjm.setToken(token);

           var deferredList = [$.Deferred(), $.Deferred()];
           
           csgozone.status(function(response) {
                if(response.success)
                   port.postMessage({msg: constants.msg.BACKGROUND_SET_INSPECT_STATUS, data: response});

                deferredList[0].resolve(response);
           });

           metjm.status(function(response) {
                if(response.success)
                   port.postMessage({msg: constants.msg.BACKGROUND_SET_SCREENSHOT_STATUS, data: response});
                
                deferredList[1].resolve(response);
           });
           
           $.when.apply(null, deferredList).then(function(csgozone_status, metjm_status) {
                if(csgozone_status.premium || metjm_status.user_has_premium)
                   return;
                
                var ad = metjm_status.ad;

               if(ad === undefined || ad.valid_until < new Date().getTime())
                   return;
                
                broadcastEvent({msg: constants.msg.ADVERT, data: ad});
           });
        } else {
            metjm.status(function(metjm_status) {
                var ad = metjm_status.ad;

               if(ad === undefined || ad.valid_until < new Date().getTime())
                   return;
                
                broadcastEvent({msg: constants.msg.ADVERT, data: ad});
            });
        }

        isLoggedIn = token !== null;
    }

    function onMessage(request, port) {
        switch(request.msg) {
            case constants.msg.PLUGIN_STATUS:
                 isEnabled = request.status;
                 broadcastEvent(request);
                 break;
            case constants.msg.BROADCAST_ITEM:
                 steamwizard.storeItem(request.namespace, request.key, request.value);
                 broadcastEvent(request);
                 break;
            case constants.msg.BROADCAST_INSPECT_USAGE:
                 broadcastEvent(request);
                 break;
            case constants.msg.BROADCAST_INSPECT_STATUS:
                 broadcastEvent(request);
                 break;
            case constants.msg.BROADCAST_SCREENSHOT_STATUS:
                 broadcastEvent(request);
                 break;
            case constants.msg.BROADCAST_TOKEN:
                token = request.data;
                broadcastEvent({msg: constants.msg.USERNAME, data:parseToken(request.token)});
                break;
            case constants.msg.BROADCAST_REVOKE_TOKEN:
                broadcastEvent(request);
                break;
        }
    }

    function broadcastEvent(msg) {
        for(var i = 0; i < eventListeners.length; i++)
            eventListeners[i](msg);
    }

    function ready() {
        processLogin();

        isReady = true;

        for(var i=0; i < onReadyList.length; i++)
            onReadyList[i]();
    };

    /* 
     * Initialize 
     */
    (function() {
        if (!validateToken(token_msg.token)) {
            token = null;
            port.postMessage({msg: constants.msg.BACKGROUND_REVOKE_TOKEN});
        }
        
        storage[NAMESPACE_SCREENSHOT] = screenshot_storage.value || {};
        storage[NAMESPACE_MARKET_INSPECT] = inspect_storage.value || {};
                     
        var deferredList = [];

        port.onMessage.addListener(onMessage);

        if(token === null) {
            deferredList.push(csgozone.login(loginCallback));
            deferredList.push(metjm.login(loginCallback));
         }

        $.when.apply(null, deferredList).then(ready);
    })();

    var steamwizard = {
        EVENT_STATUS_PROGRESS: 1,
        EVENT_STATUS_DONE: 2,
        EVENT_STATUS_FAIL: 3,
        
        /* JQUERY STYLE */
        ready: function(callback) {
            if(isReady)
               callback();
            else 
               onReadyList.push(callback);
        },

        addEventListener: function(callback) {
            if(eventListeners.indexOf(callback) > -1)
               return;

            eventListeners.push(callback);
        },

        isEnabled: function() {
            return isEnabled;
        },

        isLoggedIn: function() {
            return isLoggedIn;
        },

        getUsername : function(withDomain){
            var jsonToken = parseToken(token);
            if (jsonToken && jsonToken.name) {
                if (withDomain) {
                    var issuer = "";
                    if (withDomain && jsonToken.issuer == "ISSUED_BY_METJM")
                        issuer = " (metjm.net)";
                    else if (withDomain && jsonToken.issuer == "ISSUED_BY_CSGOZONE")
                        issuer = " (csgozone.net)";
                    return (jsonToken.name + issuer);
                } else {
                    return jsonToken.name;
                }
            } else {
                return null;
            }
        },

        refreshToken : function(callback){
            token = null;
            port.postMessage({msg: constants.msg.BACKGROUND_REVOKE_TOKEN});
            steamwizard.login(callback);
        },

        revokeToken: function() {
            token = null;
            isLoggedIn = false;
            port.postMessage({msg: constants.msg.BACKGROUND_REVOKE_TOKEN});
        },

        login: function(callback) {
            $.when(csgozone.login(loginCallback), metjm.login(loginCallback)).then(function() {
                processLogin();
                callback();
            });
        },

        storeItem: function(namespace, key, value, notifyBackground) {
            if (!storage[namespace])
                 storage[namespace] = {};

            storage[namespace][key] = value;

            if(notifyBackground)
               port.postMessage({msg: constants.msg.BACKGROUND_SET_ITEM, namespace: namespace, key: key, value: value});
        },

        /* services */
        getScreenshot: function(inspectLink, callback) {
            metjm.requestScreenshot(inspectLink, function(result){
                if (result.success) {
                    if(result.result.status == metjm.STATUS_QUEUE){
                        callback({status: steamwizard.EVENT_STATUS_PROGRESS , msg: 'Queue: ' + result.result.place_in_queue});
                    }else if (result.result.status == metjm.STATUS_DONE){
                        steamwizard.storeItem(NAMESPACE_SCREENSHOT, util.getAssetID(inspectLink), result.result.image_url, true);
                        callback({status: steamwizard.EVENT_STATUS_DONE , image_url: result.result.image_url});
                    }else{
                        callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});
                    }
                } else {
                    callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});

                    if(result.bad_token)
                       steamwizard.revokeToken();
                }
            });
        },

        getFloatValue: function(inspectLink, callback) {
            csgozone.market(inspectLink, function(data) {
                if(data.success === true) {
                    steamwizard.storeItem(NAMESPACE_MARKET_INSPECT, util.getAssetID(inspectLink), data, true);
                    callback({status: steamwizard.EVENT_STATUS_DONE , data: data});
                    port.postMessage({msg: constants.msg.BACKGROUND_INCREASE_INSPECT_USAGE, amount: 1});
                } else {
                   callback({status: steamwizard.EVENT_STATUS_FAIL , msg:'Failed'});
                   if(data.bad_token)
                      steamwizard.revokeToken();
                }
            });
        },

        getFloatValueCachedFromAssetid : function(assetid){
                return storage[NAMESPACE_MARKET_INSPECT][assetid];
        },

        getFloatValueCached : function(inspectLink){
            var assetid = util.getAssetID(inspectLink);
            return storage[NAMESPACE_MARKET_INSPECT][assetid];
        },

        getScreenshotCachedFromAssetid : function(assetid){
                return storage[NAMESPACE_SCREENSHOT][assetid];
        },

        getScreenshotCached : function(inspectLink){
            var assetid = util.getAssetID(inspectLink);
            return storage[NAMESPACE_SCREENSHOT][assetid];
        },
        
        /* options */
        getMarketDisplayCount: function() {
            var count = window.localStorage.getItem("steam_wizard_num_market_items");
            
            return count == null ? 10 : parseInt(count);
        },
        
        saveMarketDisplayCount: function(count) {
            window.localStorage.setItem("steam_wizard_num_market_items", count);
        },
        
        displayQuotaWarning: function() {
            if(window.localStorage.getItem("steam_wizard_quota_warning_displayed"))
               return false;
            
            window.localStorage.setItem("steam_wizard_quota_warning_displayed", true);
            return true;            
        },
        
        log: function() {
            csgozone.log(version);
            metjm.log(version);
        },
        
        getMarketAffiliates: function(callback) {
//            csgozone.affiliates(callback);
            csgozone.affiliates(callback);
        },
    };        

    return steamwizard;
});
