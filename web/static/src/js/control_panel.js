odoo.define('web.ControlPanelMixin', function (require) {
"use strict";

/**
 * Mixin allowing widgets to communicate with the ControlPanel. Widgets needing a
 * ControlPanel should use this mixin and call update_control_panel(cp_status) where
 * cp_status contains information for the ControlPanel to update itself.
 */
var ControlPanelMixin = {
    need_control_panel: true,
    /**
     * @param {web.Bus} [cp_bus] Bus to communicate with the ControlPanel
     */
    set_cp_bus: function(cp_bus) {
        this.cp_bus = cp_bus;
    },
    /**
     * Triggers 'update' on the cp_bus to update the ControlPanel according to cp_status
     * @param {Object} [cp_status] see web.ControlPanel.update() for a description
     */
    update_control_panel: function(cp_status) {
        this.cp_bus.trigger("update", cp_status || {});
    },
};

return ControlPanelMixin;

});

odoo.define('web.ControlPanel', function (require) {
"use strict";

var config = require('web.config');
var core = require('web.core');
var Widget = require('web.Widget');

var ControlPanel = Widget.extend({
    template: 'ControlPanel',
    /**
     * @param {String} [template] the QWeb template to render the ControlPanel.
     * By default, the template 'ControlPanel' will be used
     */
    init: function(parent, template) {
        this._super(parent);
        if (template) {
            this.template = template;
        }

        this.bus = new core.Bus();
        this.bus.on("update", this, this.update);
        this.bus.on("update_breadcrumbs", this, this.update_breadcrumbs);
    },
    start: function() {
        this.$breadcrumbs = this.$('.breadcrumb');

        // Exposed jQuery nodesets
        this.nodes = {
            $searchview: this.$('.o_cp_searchview'),
            $searchview_buttons: this.$('.o_search_options'),
            $buttons: this.$('.o_cp_buttons'),
            $sidebar: this.$('.o_cp_sidebar'),
            $pager: this.$('.o_cp_pager'),
            $switch_buttons: this.$('.o_cp_switch_buttons'),
        };

        // By default, hide the ControlPanel and remove its contents from the DOM
        this.toggle_visibility(false);

        return this._super();
    },
    /**
     * @return {Object} the Bus the ControlPanel is listening on
     */
    get_bus: function() {
        return this.bus;
    },
    /**
     * Hides (or shows) the ControlPanel in headless (resp. non-headless) mode
     * Also detaches or attaches its contents to clean the DOM
     */
    toggle_visibility: function(visible) {
        this.$el.toggle(visible);
        if (!visible && !this.$content) {
            this.$content = this.$el.contents().detach();
        } else if (this.$content) {
            this.$content.appendTo(this.$el);
            this.$content = null;
        }
    },
    /**
     * Detaches the content of the ControlPanel
     */
    _detach_content: function() {
        _.each(this.nodes, function($nodeset) {
            $nodeset.contents().detach();
        });
    },
    /**
     * Attaches content to the ControlPanel
     * @param {Object} [content] dictionnary of jQuery elements to attach, whose keys
     * are jQuery nodes identifiers in this.nodes
     */
    _attach_content: function(content) {
        var self = this;
        _.each(content, function($nodeset, $element) {
            if ($nodeset && self.nodes[$element]) {
                $nodeset.appendTo(self.nodes[$element]);
            }
        });
    },
    /**
     * Updates the content and display of the ControlPanel
     * @param {Object} [status.active_view] the current active view
     * @param {Array} [status.breadcrumbs] the breadcrumbs to display
     * @param {Object} [status.cp_content] dictionnary containing the new ControlPanel jQuery elements
     * @param {Boolean} [status.hidden] true if the ControlPanel should be hidden
     * @param {openerp.web.SearchView} [status.searchview] the searchview widget
     * @param {Boolean} [status.search_view_hidden] true if the searchview is hidden, false otherwise
     */
    update: function(status) {
        this.toggle_visibility(!status.hidden);
        if (!status.hidden) {
            // Don't update the ControlPanel in headless mode as the views have
            // inserted themselves the buttons where they want, so inserting them
            // again in the ControlPanel will removed them from there they should be
            this._detach_content();
            this._attach_content(status.cp_content);
            this.update_search_view(status.searchview, status.search_view_hidden);
            if (status.active_view_selector) this.update_switch_buttons(status.active_view_selector);
            if (status.breadcrumbs) this.update_breadcrumbs(status.breadcrumbs);
        }
    },
    /**
     * Removes active class on all switch-buttons and adds it to the one of the active view
     * @param {Object} [active_view_selector] the selector of the div to activate
     */
    update_switch_buttons: function(active_view_selector) {
        _.each(this.nodes.$switch_buttons.find('button'), function(button) {
            $(button).removeClass('active');
        });
        this.$(active_view_selector).addClass('active');
    },
    /**
     * Updates the breadcrumbs
     **/
    update_breadcrumbs: function (breadcrumbs) {
        var self = this;

        if (!breadcrumbs.length) return;

        var $breadcrumbs = breadcrumbs.map(function (bc, index) {
            return make_breadcrumb(bc, index, breadcrumbs.length);
        });

        this.$breadcrumbs
            .empty()
            .append($breadcrumbs);

        function make_breadcrumb (bc, index, length) {
            var is_last = (index === length-1);
            var is_before_last = index === length-2

            var $bc = $('<li>')
                    .append(is_last ? bc.title : $('<a>').html(bc.title))
                    .toggleClass('hidden-xs', !is_last && !is_before_last)
                    .toggleClass('o_back_button', is_before_last)
                    .toggleClass('active', is_last);
            if (!is_last) {
                $bc.click(function () {
                    self.trigger("on_breadcrumb_click", bc.action, bc.index);
                });
            }
            return $bc;
        }
    },
    /**
     * Updates the SearchView's visibility and extend the breadcrumbs area if the SearchView is not visible
     * @param {openerp.web.SearchView} [searchview] the searchview Widget
     * @param {Boolean} [is_hidden] visibility of the searchview
     **/
    update_search_view: function(searchview, is_hidden) {
        if (searchview) {
            this.nodes.$searchview.toggle(!is_hidden);
            // Set the $buttons div (in the DOM) of the searchview as the $buttons
            // have been appended to a jQuery node not in the DOM at SearchView initialization
            searchview.$buttons = this.nodes.$searchview_buttons;
            searchview.toggle_visibility(!is_hidden);
            this.$el.toggleClass('o_breadcrumb_full', is_hidden || config.mobile);

            if(this.$enable_searchview === undefined) {
                var self = this;
                this.$enable_searchview = $('<button/>', {type: 'button'})
                    .addClass('o_enable_searchview btn btn-sm btn-default fa fa-search')
                    .on('click', function() {
                        self.$el.toggleClass('o_breadcrumb_full');
                });
            }
            if(!is_hidden && config.mobile) {
                this.$enable_searchview.insertAfter(this.nodes.$searchview);
            } else {
                this.$enable_searchview.detach();
            }
        } else {
            // Show the searchview buttons area, which might have been hidden by
            // the searchview, as client actions may insert elements into it
            this.nodes.$searchview_buttons.show();
        }
    },
});

return ControlPanel;

});
