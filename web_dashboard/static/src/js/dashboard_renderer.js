odoo.define('web_dashboard.DashboardRenderer', function (require) {
"use strict";

var Domain = require('web.Domain');
var fieldUtils = require('web.field_utils');
var FormRenderer = require('web.FormRenderer');
var viewRegistry = require('web.view_registry');

var DashboardRenderer = FormRenderer.extend({
    className: "o_dashboard_view",
    events: {
        'click .o_aggregate': '_onAggregateClicked',
    },
    // override the defaul col attribute for groups as in the dashbard view,
    // labels and fields are displayed vertically, thus allowing to display
    // more fields on the same line
    OUTER_GROUP_COL: 6,

    /**
     * @override
     */
    init: function (parent, state, params) {
        this._super.apply(this, arguments);
        this.mode = 'readonly';
        this.subFieldsViews = params.subFieldsViews;
        this.additionalMeasures = params.additionalMeasures;
        this.subControllers = {};
        this.subControllersContext = _.pick(state.context || {}, 'pivot', 'graph');
        this.formatOptions = {
            // in the dashboard view, all monetary values are displayed in the
            // currency of the current company of the user
            currency_id: this.getSession().company_currency_id,
        };
    },
    /**
     * @override
     */
    on_attach_callback: function () {
        this._super.apply(this, arguments);
        this.isInDOM = true;
        _.invoke(this.subControllers, 'on_attach_callback');
    },
    /**
     * @override
     */
    on_detach_callback: function () {
        this._super.apply(this, arguments);
        this.isInDOM = false;
        // store the subviews' context to restore them properly if we come back
        // to the dashboard later
        for (var viewType in this.subControllers) {
            this.subControllersContext[viewType] = this.subControllers[viewType].getContext();
        }
    },

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Returns a dict containing the context of sub views.
     *
     * @returns {Object}
     */
    getsubControllersContext: function () {
        return _.mapObject(this.subControllers, function (controller) {
            return controller.getContext();
        });
    },
    /**
     * Overrides to update the context of sub controllers.
     *
     * @override
     */
    updateState: function (state, params) {
        var subControllersContext = _.pick(params.context || {}, 'pivot', 'graph');
        _.extend(this.subControllersContext, subControllersContext);
        return this._super.apply(this, arguments);
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Renders an aggregate (or formula)'s label.
     *
     * @private
     * @param {Object} node
     * @returns {jQueryElement}
     */
    _renderLabel: function (node) {
        var text = node.attrs.name;
        if ('string' in node.attrs) { // allow empty string
            text = node.attrs.string;
        }
        var $result = $('<label>', {text: text});
        return $result;
    },
    /**
     * Renders a statistic (from an aggregate or a formula) with its label.
     * If a widget attribute is specified, and if there is no corresponding
     * formatter, instanciates a widget to render the value. Otherwise, simply
     * uses the corresponding formatter (with a fallback on the field's type).
     *
     * @private
     * @param {Object} node
     * @returns {jQueryElement}
     */
    _renderStatistic: function (node) {
        var $label = this._renderLabel(node);
        var $value;
        if (!node.attrs.widget || (node.attrs.widget in fieldUtils.format)) {
            // use a formatter to render the value if there exists one for the
            // specified widget attribute, or there is no widget attribute
            var statisticName = node.attrs.name;
            var fieldValue = this.state.data[statisticName];
            if (isNaN(fieldValue)) {
                $value = $('<div>', {class: 'o_value'}).html("-");
            } else {
                var statistic = this.state.fieldsInfo.dashboard[statisticName];
                var formatType = node.attrs.widget || statistic.type;
                var formatter = fieldUtils.format[formatType];
                fieldValue = formatter(fieldValue, statistic, this.formatOptions);
                $value = $('<div>', {class: 'o_value'}).html(fieldValue);
            }
        } else {
            // instantiate a widget to render the value if there is no formatter
            $value = this._renderFieldWidget(node, this.state).addClass('o_value');
        }
        var $el = $('<div>')
            .attr('name', node.attrs.name)
            .append($label)
            .append($value);
        this._registerModifiers(node, this.state, $el);
        return $el;
    },
    /**
     * Renders the buttons of a given sub view, with an additional button to
     * open the view in full screen.
     *
     * @private
     */
    _renderSubViewButtons: function ($el, controller) {
        var $buttons = $('<div>', {class: 'o_' + controller.viewType + '_buttons'});

        // render the view's buttons
        controller.renderButtons($buttons);

        // render the button to open the view in full screen
        $('<button>')
            .addClass("btn btn-default fa fa-expand pull-right o_button_switch")
            .attr({title: 'Full Screen View', viewType: controller.viewType})
            .tooltip()
            .on('click', this._onViewSwitcherClicked.bind(this))
            .appendTo($buttons);

        $buttons.prependTo($el);
    },
    /**
     * @private
     * @param {Object} node
     * @returns {jQueryElement}
     */
    _renderTagAggregate: function (node) {
        var $aggregate = this._renderStatistic(node).addClass('o_aggregate'); // make it clickable
        var $result = $('<div>').append($aggregate);
        this._registerModifiers(node, this.state, $result);
        return $result;
    },
    /**
     * @private
     * @param {Object} node
     * @returns {jQueryElement}
     */
    _renderTagFormula: function (node) {
        return this._renderStatistic(node).addClass('o_formula');
    },
    /**
     * In the dashboard, both inner and outer groups are rendered the same way:
     * with a div (no table), i.e. like the outer group of the form view.
     *
     * @override
     * @private
     */
    _renderTagGroup: function (node) {
        return this._renderOuterGroup(node);
    },
    /**
     * Handles nodes with tagname 'view': instanciates the requested view,
     * renders its buttons and returns a jQuery element containing the buttons
     * and the controller's $el.
     *
     * @private
     * @param {Object} node
     * @returns {jQueryElement}
     */
    _renderTagView: function (node) {
        var self = this;
        var viewType = node.attrs.type;
        var controllerContext = this.subControllersContext[viewType];
        var subViewParams = {
            context: _.extend({}, this.state.context, controllerContext),
            domain: this.state.domain,
            groupBy: [],
            modelName: this.state.model,
            withControlPanel: false,
            hasSwitchButton: true,
            additionalMeasures: this.additionalMeasures,
        };
        var SubView = viewRegistry.get(viewType);
        var subView = new SubView(this.subFieldsViews[viewType], subViewParams);
        var $div = $('<div>', {class: 'o_subview', type: viewType});
        var def = subView.getController(this).then(function (controller) {
            return controller.appendTo($div).then(function () {
                self._renderSubViewButtons($div, controller);
                self.subControllers[viewType] = controller;
            });
        });
        this.defs.push(def);
        return $div;
    },
    /**
     * Overrides to destroy potentially previously instantiates sub views, and
     * to call 'on_attach_callback' on the new sub views if the dashboard if
     * already in the DOM when being rendered.
     *
     * @override
     * @private
     */
    _renderView: function () {
        var self = this;
        var oldControllers = _.values(this.subControllers);
        return this._super.apply(this, arguments).then(function () {
            _.invoke(oldControllers, 'destroy');
            if (self.isInDOM) {
                _.invoke(self.subControllers, 'on_attach_callback');
            }
        });
    },
    /**
     * Overrides to get rid of the FormRenderer logic about fields, as there is
     * no field tag in the dashboard view. Simply updates the renderer's $el.
     *
     * @private
     * @override
     */
    _updateView: function ($newContent) {
        this.$el.html($newContent);
    },

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * Handles the click on a measure (i.e. a real field of the model, not a
     * formula). Activates this measure on subviews, and if there is a domain
     * specified, activates this domain on the whole dashboard.
     *
     * @private
     * @param {MouseEvent} ev
     */
    _onAggregateClicked: function (ev) {
        // update the measure(s) of potential graph and pivot subcontrollers
        // (this doesn't trigger a reload, it only updates the internal state
        // of those controllers)
        var aggregate = ev.currentTarget.getAttribute('name');
        var aggregateInfo = this.state.fieldsInfo.dashboard[aggregate];
        var measure = aggregateInfo.field;
        if (this.subControllers.pivot) {
            this.subControllersContext.pivot = _.extend(this.subControllers.pivot.getContext(), {
                pivot_measures: [measure],
            });
        }
        if (this.subControllers.graph) {
            this.subControllersContext.graph = _.extend(this.subControllers.graph.getContext(), {
                graph_measure: measure,
            });
        }

        // update the domain and trigger a reload
        var domain = new Domain(aggregateInfo.domain);
        // I don't know if it is a good idea to use this.state.fields[measure].string
        var label = aggregateInfo.domain_label || aggregateInfo.string || aggregateInfo.name;
        this.trigger_up('reload', {
            domain: domain.toArray(),
            domainLabel: label,
        });
    },
    /**
     * Sends a request to open the given view in full screen.
     *
     * @todo; take the current domain into account, once it will be correctly
     * propagated to subviews
     * @private
     * @param {MouseEvent} ev
     */
    _onViewSwitcherClicked: function (ev) {
        ev.stopPropagation();
        var viewType = $(ev.currentTarget).attr('viewType');
        var controller = this.subControllers[viewType];
        this.trigger_up('open_view', {
            context: _.extend({}, this.state.context, controller.getContext()),
            viewType: viewType,
            additionalMeasures: this.additionalMeasures,
        });
    },
});

return DashboardRenderer;

});