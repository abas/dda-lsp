odoo.define('web_enterprise.DebugManager', function (require) {
"use strict";

var config = require('web.config');
var WebClient = require('web.WebClient');

if (config.debug) {
    WebClient.include({
        start: function() {
            var self = this;
            return this._super.apply(this, arguments).then(function () {
                // Override toggle_home_menu to trigger an event to update the debug manager's state
                var toggle_home_menu = self.toggle_home_menu;
                self.toggle_home_menu = function(display) {
                    var action;
                    if (!display) {
                        action = self.action_manager.get_inner_action();
                    }
                    self.current_action_updated(action);
                    toggle_home_menu.apply(self, arguments);
                };
            });
        },
        instanciate_menu_widgets: function() {
            var self = this;
            return this._super.apply(this, arguments).then(function() {
                // Compatibility with community debug manager
                self.systray_menu = self.menu.systray_menu;
            });
        },
    });
}

});
