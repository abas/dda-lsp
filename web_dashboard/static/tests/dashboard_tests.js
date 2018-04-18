odoo.define('web_dashboard.dashboard_tests', function (require) {
"use strict";

var BasicFields = require('web.basic_fields');
var DashboardView = require('web_dashboard.DashboardView');
var fieldRegistry = require('web.field_registry');
var testUtils = require('web.test_utils');
var Widget = require('web.Widget');
var widgetRegistry = require('web.widget_registry');

var createActionManager = testUtils.createActionManager;
var createView = testUtils.createView;
var FieldFloat = BasicFields.FieldFloat;

QUnit.module('Views', {
    beforeEach: function () {
        this.data = {
            test_report : {
                fields: {
                    categ_id: {string: "categ_id", type: 'many2one', relation: 'test_report'},
                    sold: {string: "Sold", type: 'float', store: true, group_operator:'sum'},
                    untaxed: {string: "Untaxed", type: 'float', group_operator:'sum', store: true},
                },
                records: [{
                    display_name: "First",
                    id: 1,
                    sold: 5,
                    untaxed: 10,
                    categ_id: 1,
                }, {
                    display_name: "Second",
                    id: 2,
                    sold: 3,
                    untaxed: 20,
                    categ_id: 2,
                }],
            },
        };
    }
}, function () {

    QUnit.module('DashboardView');

    QUnit.test('basic rendering of a dashboard with groups', function (assert) {
        assert.expect(3);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<group></group>' +
                        '</group>' +
                    '</dashboard>',
        });

        assert.strictEqual(dashboard.$('.o_dashboard_view').length, 1,
            "root has a child with 'o_dashboard_view' class");
        assert.strictEqual(dashboard.$('.o_group').length, 2,
            "should have rendered two groups");
        assert.ok(dashboard.$('.o_group .o_group').hasClass('o_group_col_2'),
            "inner group should have className o_group_col_2");

        dashboard.destroy();
    });

    QUnit.test('basic rendering of a widget tag', function (assert) {
        assert.expect(1);

        var MyWidget = Widget.extend({
            init: function (parent, dataPoint) {
                this.data = dataPoint.data;
                this._super.apply(this, arguments);
            },
            start: function () {
                this.$el.text(JSON.stringify(this.data));
            },
        });
        widgetRegistry.add('test', MyWidget);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<widget name="test"/>' +
                    '</dashboard>',
        });

        assert.strictEqual(dashboard.$('.o_widget').length, 1,
            "there should be a node with widget class");

        dashboard.destroy();
        delete widgetRegistry.map.test;
    });

    QUnit.test('basic rendering of an aggregate tag inside a group', function (assert) {
        assert.expect(8);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="sold" field="sold"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['sold:sum(sold)'],
                        "should read the correct field");
                    assert.deepEqual(args.kwargs.domain, [],
                        "should send the correct domain");
                    assert.deepEqual(args.kwargs.groupby, [],
                        "should send the correct groupby");
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('.o_aggregate').length, 1,
            "should have rendered an aggregate");
        assert.strictEqual(dashboard.$('.o_aggregate > label').text(), 'sold',
            "should have correctly rendered the aggregate's label");
        assert.strictEqual(dashboard.$('.o_aggregate > .o_value').text(), '8.00',
            "should correctly display the aggregate's value");
        assert.verifySteps(['read_group']);

        dashboard.destroy();
    });

    QUnit.test('basic rendering of a aggregate tag with widget attribute', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group string="At a glance">' +
                            '<aggregate name="sold" field="sold" widget="float_time"/>' +
                        '</group>' +
                    '</dashboard>',
        });

        assert.strictEqual(dashboard.$('.o_value').text(), '08:00',
            "should correctly display the aggregate's value");

        dashboard.destroy();
    });

    QUnit.test('basic rendering of a formula tag inside a group', function (assert) {
        assert.expect(8);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="sold" field="sold"/>' +
                            '<aggregate name="untaxed" field="untaxed"/>' +
                            '<formula name="formula" string="Some label" value="record.sold * record.untaxed"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['sold:sum(sold)', 'untaxed:sum(untaxed)'],
                        "should read the correct fields");
                    assert.deepEqual(args.kwargs.domain, [],
                        "should send the correct domain");
                    assert.deepEqual(args.kwargs.groupby, [],
                        "should send the correct groupby");
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('[name="formula"]').length, 1,
            "should have rendered a formula");
        assert.strictEqual(dashboard.$('[name="formula"] > label').text(), 'Some label',
            "should have correctly rendered the label");
        assert.strictEqual(dashboard.$('[name="formula"] > .o_value').text(), '240.00',
            "should have correctly computed the formula value");
        assert.verifySteps(['read_group']);

        dashboard.destroy();
    });

    QUnit.test('basic rendering of a graph tag', function (assert) {
        assert.expect(8);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="graph" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
            },
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['categ_id', 'sold'],
                        "should read the correct fields");
                    assert.deepEqual(args.kwargs.groupby, ['categ_id'],
                        "should group by the correct field");
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('.o_subview .o_graph_buttons').length, 1,
            "should have rendered the graph view's buttons");
        assert.strictEqual(dashboard.$('.o_subview .o_graph_buttons .o_button_switch').length,
            1, "should have rendered an additional switch button");
        assert.strictEqual(dashboard.$('.o_subview .o_graph').length, 1,
            "should have rendered a graph view");

        assert.verifySteps(['load_views', 'read_group']);

        dashboard.destroy();
    });

    QUnit.test('basic rendering of a pivot tag', function (assert) {
        assert.expect(11);

        var nbReadGroup = 0;
        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="pivot" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,pivot': '<pivot>' +
                        '<field name="categ_id" type="row"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</pivot>',
            },
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                if (args.method === 'read_group') {
                    nbReadGroup++;
                    var groupBy = nbReadGroup === 1 ? [] : ['categ_id'];
                    assert.deepEqual(args.kwargs.fields, ['categ_id', 'sold'],
                        "should read the correct fields");
                    assert.deepEqual(args.kwargs.groupby, groupBy,
                        "should group by the correct field");
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('.o_subview .o_pivot_buttons').length, 1,
            "should have rendered the pivot view's buttons");
        assert.strictEqual(dashboard.$('.o_subview .o_pivot_buttons .o_button_switch').length,
            1, "should have rendered an additional switch button");
        assert.strictEqual(dashboard.$('.o_subview .o_pivot').length, 1,
            "should have rendered a graph view");

        assert.verifySteps(['load_views', 'read_group', 'read_group']);

        dashboard.destroy();
    });

    QUnit.test('rendering of an aggregate with widget monetary', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group><aggregate name="sold" field="sold" widget="monetary"/></group>' +
                    '</dashboard>',
            session: {
                company_currency_id: 44,
                currencies: {
                    44: {
                        digits: [69, 2],
                        position: "after",
                        symbol: "€"
                    }
                }
            },
        });

        assert.strictEqual(dashboard.$('.o_value').text(), '8.00\u00a0€',
            "should format the amount with the correct currency");

        dashboard.destroy();
    });

    QUnit.test('rendering of field of type many2one', function (assert) {
        assert.expect(2);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="categ_id" field="categ_id"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['categ_id:count_distinct(categ_id)'],
                        "should specify 'count_distinct' group operator");
                    // mockReadGroup doesn't implement other group operators than
                    // 'sum', so we hardcode the result of the 'count_disting' here
                    return this._super.apply(this, arguments).then(function (res) {
                        res[0].categ_id = 2;
                        return res;
                    });
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('.o_value').text(), '2',
            "should correctly display the value, formatted as an integer");

        dashboard.destroy();
    });

    QUnit.test('rendering of formula with widget attribute (formatter)', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<aggregate name="sold" field="sold" invisible="1"/>' +
                        '<aggregate name="untaxed" field="untaxed" invisible="1"/>' +
                        '<formula label="Some value" value="record.sold / record.untaxed" widget="percentage"/>' +
                    '</dashboard>',
        });

        assert.strictEqual(dashboard.$('.o_value:visible').text(), '26.67%',
            "should correctly display the value");

        dashboard.destroy();
    });

    QUnit.test('rendering of formula with widget attribute (widget)', function (assert) {
        assert.expect(1);

        var MyWidget = FieldFloat.extend({
            start: function () {
                this.$el.text('The value is ' + this._formatValue(this.value));
            },
        });
        fieldRegistry.add('test', MyWidget);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<aggregate name="sold" field="sold" invisible="1"/>' +
                        '<aggregate name="untaxed" field="untaxed" invisible="1"/>' +
                        '<formula name="some_value" value="record.sold / record.untaxed" widget="test"/>' +
                    '</dashboard>',
        });

        assert.strictEqual(dashboard.$('.o_value:visible').text(), 'The value is 0.27',
            "should have used the specified widget (as there is no 'test' formatter)");

        dashboard.destroy();
        delete fieldRegistry.map.test;
    });

    QUnit.test('invisible attribute on a field', function (assert) {
        assert.expect(2);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group><aggregate name="sold" field="sold" invisible="1"/></group>' +
                    '</dashboard>',
        });

        assert.ok(dashboard.$('.o_group > div').hasClass('o_invisible_modifier'),
            "the aggregate container should be invisible");
        assert.ok(dashboard.$('.o_aggregate[name=sold]').hasClass('o_invisible_modifier'),
            "the aggregate should be invisible");

        dashboard.destroy();
    });

    QUnit.test('invisible attribute on a formula', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<formula name="formula" value="2" invisible="1"/>' +
                    '</dashboard>',
        });

        assert.ok(dashboard.$('.o_formula').hasClass('o_invisible_modifier'),
            "the formula should be invisible");

        dashboard.destroy();
    });

    QUnit.test('invisible modifier on an aggregate', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="untaxed" field="untaxed" />' +
                            '<aggregate name="sold" field="sold"  attrs="{\'invisible\': [(\'untaxed\',\'=\',30)]}"/>' +
                        '</group>' +
                    '</dashboard>',
        });

        assert.ok(dashboard.$('.o_aggregate[name=sold]').hasClass('o_invisible_modifier'),
            "the aggregate 'sold' should be invisible");

        dashboard.destroy();
    });

    QUnit.test('invisible modifier on a formula', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="sold" field="sold"/>' +
                            '<aggregate name="untaxed" field="untaxed"/>' +
                            '<formula label="Some value" value="record.sold / record.untaxed" attrs="{\'invisible\': [(\'untaxed\',\'=\',30)]}"/>' +
                        '</group>' +
                    '</dashboard>',
        });

        assert.ok(dashboard.$('.o_formula').hasClass('o_invisible_modifier'),
            "the formula should be invisible");

        dashboard.destroy();
    });

    QUnit.test('rendering of aggregates with domain attribute', function (assert) {
        assert.expect(11);

        var nbReadGroup = 0;
        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="untaxed" field="untaxed"/>' +
                            '<aggregate name="sold" field="sold" domain="[(\'categ_id\', \'=\', 1)]"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                if (args.method === 'read_group') {
                    nbReadGroup++;
                    if (nbReadGroup === 1) {
                        assert.deepEqual(args.kwargs.fields, ['untaxed:sum(untaxed)'],
                            "should read the correct field");
                        assert.deepEqual(args.kwargs.domain, [],
                            "should send the correct domain");
                        assert.deepEqual(args.kwargs.groupby, [],
                            "should send the correct groupby");
                    } else {
                        assert.deepEqual(args.kwargs.fields, ['sold:sum(sold)'],
                            "should read the correct field");
                        assert.deepEqual(args.kwargs.domain, [['categ_id', '=', 1]],
                            "should send the correct domain");
                        assert.deepEqual(args.kwargs.groupby, [],
                            "should send the correct groupby");
                    }
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(dashboard.$('.o_aggregate[name=untaxed] .o_value').text(),
            '30.00', "should correctly display the aggregate's value");
        assert.strictEqual(dashboard.$('.o_aggregate[name=sold] .o_value').text(), '5.00',
            "should correctly display the aggregate's value");

        assert.verifySteps(['read_group', 'read_group']);

        dashboard.destroy();
    });

    QUnit.test('two aggregates with the same field attribute with different domain', function (assert) {
        assert.expect(11);

        var nbReadGroup = 0;
        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="sold" field="sold"/>' +
                            '<aggregate name="sold_categ_1" field="sold" domain="[(\'categ_id\', \'=\', 1)]"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                assert.step(args.method || route);
                var def = this._super.apply(this, arguments);
                if (args.method === 'read_group') {
                    nbReadGroup++;
                    if (nbReadGroup === 1) {
                        assert.deepEqual(args.kwargs.fields, ['sold:sum(sold)'],
                            "should read the correct field");
                        assert.deepEqual(args.kwargs.domain, [],
                            "should send the correct domain");
                        assert.deepEqual(args.kwargs.groupby, [],
                            "should send the correct groupby");
                    } else {
                        assert.deepEqual(args.kwargs.fields, ['sold_categ_1:sum(sold)'],
                            "should read the correct field");
                        assert.deepEqual(args.kwargs.domain, [['categ_id', '=', 1]],
                            "should send the correct domain");
                        assert.deepEqual(args.kwargs.groupby, [],
                            "should send the correct groupby");
                        // mockReadGroup doesn't handle this kind of requests yet, so we hardcode
                        // the result in the test
                        return def.then(function (result) {
                            result[0].sold_categ_1 = 5;
                            return result;
                        });
                    }
                }
                return def;
            },
        });

        assert.strictEqual(dashboard.$('.o_aggregate[name=sold] .o_value').text(),
            '8.00', "should correctly display the aggregate's value");
        assert.strictEqual(dashboard.$('.o_aggregate[name=sold_categ_1] .o_value').text(), '5.00',
            "should correctly display the aggregate's value");

        assert.verifySteps(['read_group', 'read_group']);

        dashboard.destroy();
    });

    QUnit.test('formula based on same field with different domains', function (assert) {
        assert.expect(1);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<group>' +
                            '<aggregate name="untaxed_categ_1" field="untaxed"  domain="[(\'categ_id\', \'=\', 1)]"/>' +
                            '<aggregate name="untaxed_categ_2" field="untaxed"  domain="[(\'categ_id\', \'=\', 2)]"/>' +
                            '<formula label="Ratio" value="record.untaxed_categ_1 / record.untaxed_categ_2"/>' +
                        '</group>' +
                    '</dashboard>',
            mockRPC: function (route, args) {
                var def = this._super.apply(this, arguments);
                if (args.method === 'read_group') {
                    // mockReadGroup doesn't handle this kind of requests yet, so we hardcode
                    // the result in the test
                    return def.then(function (result) {
                        var name = args.kwargs.fields[0].split(':')[0];
                        result[0][name] = name === 'untaxed_categ_1' ? 10.0 : 20.0;
                        return result;
                    });
                }
                return def;
            },
        });

        assert.strictEqual(dashboard.$('.o_formula .o_value').text(), '0.50',
            "should have correctly computed and displayed the formula");

        dashboard.destroy();
    });

    QUnit.test('clicking on an aggregate', function (assert) {
        assert.expect(17);

        // create an action manager to test the interactions with the search view
        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<group>' +
                            '<aggregate name="untaxed" field="untaxed"/>' +
                            '<aggregate name="sold" field="sold"/>' +
                        '</group>' +
                        '<view type="graph"/>' +
                        '<view type="pivot"/>' +
                    '</dashboard>',
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,pivot': '<pivot>' +
                        '<field name="categ_id" type="row"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</pivot>',
                'test_report,false,search': '<search></search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.fields);
                }
                return this._super.apply(this, arguments);
            },
        });

        actionManager.doAction({
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        assert.ok(actionManager.$('.o_graph_measures_list li[data-field=sold]').hasClass('selected'),
            "sold measure should be active in graph view");
        assert.notOk(actionManager.$('.o_graph_measures_list li[data-field=untaxed]').hasClass('selected'),
            "untaxed measure should not be active in graph view");
        assert.ok(actionManager.$('.o_pivot_measures_list li[data-field=sold]').hasClass('selected'),
            "sold measure should be active in pivot view");
        assert.notOk(actionManager.$('.o_pivot_measures_list li[data-field=untaxed]').hasClass('selected'),
            "untaxed measure should not be active in pivot view");

        // click on the 'untaxed' field: it should activate the 'untaxed' measure in both subviews
        actionManager.$('.o_aggregate[name=untaxed]').click();

        assert.notOk(actionManager.$('.o_graph_measures_list li[data-field=sold]').hasClass('selected'),
            "sold measure should not be active in graph view");
        assert.ok(actionManager.$('.o_graph_measures_list li[data-field=untaxed]').hasClass('selected'),
            "untaxed measure should be active in graph view");
        assert.notOk(actionManager.$('.o_pivot_measures_list li[data-field=sold]').hasClass('selected'),
            "sold measure should not be active in pivot view");
        assert.ok(actionManager.$('.o_pivot_measures_list li[data-field=untaxed]').hasClass('selected'),
            "untaxed measure should be active in pivot view");

        assert.verifySteps([
            ['untaxed:sum(untaxed)', 'sold:sum(sold)'], // fields
            ['categ_id', 'sold'], // graph
            ['categ_id', 'sold'], // pivot
            ['categ_id', 'sold'], // pivot
            ['untaxed:sum(untaxed)', 'sold:sum(sold)'], // fields
            ['categ_id', 'untaxed'], // graph
            ['categ_id', 'untaxed'], // pivot
            ['categ_id', 'untaxed'], // pivot
        ]);

        actionManager.destroy();
    });

    QUnit.test('clicking on aggregate with domain attribute', function (assert) {
        assert.expect(9);

        // create an action manager to test the interactions with the search view
        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<group>' +
                            '<aggregate name="untaxed" field="untaxed" domain="[(\'categ_id\', \'=\', 2)]" domain_label="Category 2"/>' +
                            '<aggregate name="sold" field="sold" domain="[(\'categ_id\', \'=\', 1)]"/>' +
                        '</group>' +
                    '</dashboard>',
                'test_report,false,search': '<search></search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step({
                        fields: args.kwargs.fields,
                        domain: args.kwargs.domain,
                    });
                }
                return this._super.apply(this, arguments);
            },
        });

        actionManager.doAction({
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        // click on the 'untaxed' field: it should update the domain
        actionManager.$('.o_aggregate[name=untaxed]').click();
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'Category 2',
            "should correctly display the filter in the search view");

        // click on the 'sold' field: it should update the domain
        actionManager.$('.o_aggregate[name=sold]').click();
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'sold',
            "should correctly display the filter in the search view");

        assert.verifySteps([
            // initial read_groups
            {fields: ['untaxed:sum(untaxed)'], domain: [['categ_id', '=', 2]]},
            {fields: ['sold:sum(sold)'], domain: [['categ_id', '=', 1]]},
            // 'untaxed' field clicked
            {fields: ['untaxed:sum(untaxed)'], domain: [['categ_id', '=', 2], ['categ_id', '=', 2]]},
            {fields: ['sold:sum(sold)'], domain: [['categ_id', '=', 2], ['categ_id', '=', 1]]},
            // 'sold' field clicked
            {fields: ['untaxed:sum(untaxed)'], domain: [['categ_id', '=', 1], ['categ_id', '=', 2]]},
            {fields: ['sold:sum(sold)'], domain: [['categ_id', '=', 1], ['categ_id', '=', 1]]},
        ]);

        actionManager.destroy();
    });

    QUnit.test('clicking on an aggregate with domain excluding all records for another an aggregate does not cause a crash with formulas', function (assert) {
        assert.expect(7);

        this.data.test_report.fields.untaxed_2 = {string: "Untaxed_2", type: 'float', store: true};

        _.each(this.data.test_report.records, function(record) {
            record.untaxed_2 = 3.1415;
        });

        // create an action manager to test the interactions with the search view
        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<aggregate name="untaxed" field="untaxed" domain="[(\'categ_id\', \'=\', 2)]"/>' +
                        '<aggregate name="untaxed_2" field="untaxed_2" domain="[(\'categ_id\', \'=\', 1)]"/>' +
                        '<formula name="formula" value="1 / record.untaxed_2"/>' +
                        '<formula name="formula_2" value="record.untaxed_2 / record.untaxed_2"/>' +
                    '</dashboard>',
                'test_report,false,search': '<search></search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step({
                        fields: args.kwargs.fields,
                        domain: args.kwargs.domain,
                    });
                }
                return this._super.apply(this, arguments);
            },
        });

        actionManager.doAction({
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        // click on the 'untaxed' field: we should see zeros displayed as values
        actionManager.$('.o_aggregate[name=untaxed]').click();
        assert.strictEqual($('.o_aggregate[name="untaxed_2"] > .o_value').text(), "0.00",
            "should display zero as no record satisfies constrains");
        assert.strictEqual($('.o_formula[name="formula"] > .o_value').text(), "-", "Should display '-'");
        assert.strictEqual($('.o_formula[name="formula_2"] > .o_value').text(), "-", "Should display '-'");

        actionManager.destroy();
    });

    QUnit.test('open a graph view fullscreen', function (assert) {
        assert.expect(9);

        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<view type="graph" ref="some_xmlid"/>' +
                    '</dashboard>',
                'test_report,some_xmlid,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,search': '<search>' +
                        '<filter name="categ" help="Category 1" domain="[(\'categ_id\', \'=\', 1)]"/>' +
                    '</search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.domain);
                }
                return this._super.apply(this, arguments);
            },
            intercepts: {
                do_action: function (ev) {
                    actionManager.doAction(ev.data.action, ev.data.options);
                },
            },
        });

        actionManager.doAction({
            name: 'Dashboard',
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        assert.strictEqual($('.o_control_panel .breadcrumb li').text(), 'Dashboard',
            "'Dashboard' should be displayed in the breadcrumbs");

        // activate 'Category 1' filter
        $('.o_control_panel .o_filters_menu a:contains(Category 1)').click();
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'Category 1',
            "the filter should appear in the search view");

        // open graph in fullscreen
        actionManager.$('.o_graph_buttons .o_button_switch').click();
        assert.strictEqual($('.o_control_panel .breadcrumb li:nth(1)').text(), 'Graph Analysis',
            "'Graph Analysis' should have been stacked in the breadcrumbs");
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'Category 1',
            "the filter should have been kept");

        // go back using the breadcrumbs
        $('.o_control_panel .breadcrumb a').click();

        assert.verifySteps([
            [], // initial read_group
            [['categ_id', '=', 1]], // dashboard view after applying the filter
            [['categ_id', '=', 1]], // graph view opened fullscreen
            [['categ_id', '=', 1]], // dashboard after coming back
        ]);

        actionManager.destroy();
    });

    QUnit.test('interact with a graph view and open it fullscreen', function (assert) {
        assert.expect(8);

        var activeMeasure = 'sold';
        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="graph"/></dashboard>',
            archs: {
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['categ_id', activeMeasure],
                        "should read the correct measure");
                }
                return this._super.apply(this, arguments);
            },
            intercepts: {
                do_action: function (ev) {
                    assert.step('doAction');
                    var expectedAction = {
                        context: {
                            graph_groupbys: ['categ_id'],
                            graph_measure: 'untaxed',
                            graph_mode: 'pie',
                        },
                        domain: [],
                        name: 'Graph Analysis',
                        res_model: 'test_report',
                        type: 'ir.actions.act_window',
                        views: [[false, 'graph']],
                    };
                    assert.deepEqual(ev.data.action, expectedAction,
                        "should execute an action with correct params");
                },
            },
        });

        // switch to pie mode
        assert.strictEqual(dashboard.$('.nv-multiBarWithLegend').length, 1,
            "should have rendered the graph in bar mode");
        dashboard.$('.o_graph_buttons button[data-mode=pie]').click();
        assert.strictEqual(dashboard.$('.nv-pieChart').length, 1,
            "should have switched to pie mode");

        // select 'untaxed' as measure
        activeMeasure = 'untaxed';
        assert.strictEqual(dashboard.$('.o_graph_buttons li[data-field=untaxed]').length, 1,
            "should have 'untaxed' in the list of measures");
        dashboard.$('.o_graph_buttons li[data-field=untaxed] a').click();

        // open graph in fullscreen
        dashboard.$('.o_graph_buttons .o_button_switch').click();
        assert.verifySteps(['doAction']);

        dashboard.destroy();
    });

    QUnit.test('aggregates of type many2one should be measures of subviews', function (assert) {
        assert.expect(5);

        // Define an aggregate on many2one field
        this.data.test_report.fields.product_id = {string: "Product", type: 'many2one', relation: 'product', store: true};
        this.data.product = {
            fields: {
                name: {string: "Product Name", type: "char"}
            },
            records: [{
                id: 37,
                display_name: "xphone",
            }, {
                id: 41,
                display_name: "xpad",
            }],
        };
        this.data.test_report.records[0].product_id = 37;
        this.data.test_report.records[0].product_id = 41;

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard>' +
                        '<aggregate name="product_id_something" field="product_id"/>' +
                        '<view type="graph"/>' +
                        '<view type="pivot"/>' +
                    '</dashboard>',
            archs: {
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,pivot': '<pivot>' +
                    '<field name="sold" type="measure"/>' +
                '</pivot>',
            },
            intercepts: {
                do_action: function (ev) {
                    assert.step('doAction');
                    var expectedActionFlags = {
                        additionalMeasures: ['product_id'],
                    };
                    assert.deepEqual(ev.data.action.flags, expectedActionFlags,
                        "should have passed additional measures in fullscreen");
                },
            },
        });

        assert.strictEqual(dashboard.$('.o_graph_buttons li[data-field=product_id]').length, 1,
            "should have 'Product' as a measure in the graph view");
        assert.strictEqual(dashboard.$('.o_pivot_measures_list li[data-field=product_id]').length, 1,
            "should have 'Product' as measure in the pivot view");

        // open graph in fullscreen
        dashboard.$('.o_graph_buttons .o_button_switch').click();

        assert.verifySteps(['doAction']);

        dashboard.destroy();
    });

    QUnit.test('interact with subviews, open one fullscreen and come back', function (assert) {
        assert.expect(8);

        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<view type="graph"/>' +
                        '<view type="pivot"/>' +
                    '</dashboard>',
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,pivot': '<pivot>' +
                        '<field name="sold" type="measure"/>' +
                    '</pivot>',
                'test_report,false,search': '<search></search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.fields);
                }
                return this._super.apply(this, arguments);
            },
            intercepts: {
                do_action: function (ev) {
                    actionManager.doAction(ev.data.action, ev.data.options);
                },
            },
        });

        actionManager.doAction({
            name: 'Dashboard',
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        // select 'untaxed' as measure in graph view
        actionManager.$('.o_graph_buttons li[data-field=untaxed] a').click();

        // select 'untaxed' as additional measure in pivot view
        actionManager.$('.o_pivot_measures_list li[data-field=untaxed] a').click();

        // open graph in fullscreen
        actionManager.$('.o_pivot_buttons .o_button_switch').click();

        // go back using the breadcrumbs
        $('.o_control_panel .breadcrumb a').click();

        assert.verifySteps([
            // initial read_group
            ['categ_id', 'sold'], // graph in dashboard
            ['sold'], // pivot in dashboard

            // after changing the measure in graph
            ['categ_id', 'untaxed'], // graph in dashboard

            // after changing the measures in pivot
            ['sold', 'untaxed'], // pivot in dashboard

            // pivot opened fullscreen
            ['sold', 'untaxed'],

            // after coming back
            ['categ_id', 'untaxed'], // graph in dashboard
            ['sold', 'untaxed'], // pivot in dashboard
        ]);

        actionManager.destroy();
    });

    QUnit.test('open subview fullscreen, update domain and come back', function (assert) {
        // This test encodes the current behavior of this particular scenario, which is not the one
        // we want, but with the current implementation of the searchview, we can't really do better.
        // When coming back to the dashboard, the state of the searchview as it was when we left
        // should be restored. So two assertions of this test will have to be adapted once the
        // searchview will be rewrote, and when the desired behavior will be implemented.
        assert.expect(7);

        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<view type="graph"/>' +
                    '</dashboard>',
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,search': '<search>' +
                       '<filter name="sold" help="Sold" domain="[(\'sold\', \'=\', 10)]"/>' +
                    '</search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.domain);
                }
                return this._super.apply(this, arguments);
            },
            intercepts: {
                do_action: function (ev) {
                    actionManager.doAction(ev.data.action, ev.data.options);
                },
            },
        });

        actionManager.doAction({
            name: 'Dashboard',
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        // open graph in fullscreen
        actionManager.$('.o_graph_buttons .o_button_switch').click();

        // filter on bar
        $('.o_control_panel .o_filters_menu a:contains(Sold)').click();
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'Sold',
            "should correctly display the filter in the search view");

        // go back using the breadcrumbs
        $('.o_control_panel .breadcrumb a').click();
        assert.strictEqual($('.o_control_panel .o_facet_values').text().trim(), 'Sold',
            "should still display the filter in the search view");

        assert.verifySteps([
            [], // graph in dashboard
            [], // graph full screen
            [['sold', '=', 10]], // graph full screen with filter applied
            [['sold', '=', 10]], // graph in dashboard after coming back
        ]);

        actionManager.destroy();
    });

    QUnit.test('action domain is kept when going back and forth to fullscreen subview', function (assert) {
        assert.expect(4);

        var actionManager = createActionManager({
            data: this.data,
            archs: {
                'test_report,false,dashboard': '<dashboard>' +
                        '<view type="graph"/>' +
                    '</dashboard>',
                'test_report,false,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
                'test_report,false,search': '<search></search>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.domain);
                }
                return this._super.apply(this, arguments);
            },
            intercepts: {
                do_action: function (ev) {
                    actionManager.doAction(ev.data.action, ev.data.options);
                },
            },
        });

        actionManager.doAction({
            name: 'Dashboard',
            domain: [['categ_id', '=', 1]],
            res_model: 'test_report',
            type: 'ir.actions.act_window',
            views: [[false, 'dashboard']],
        });

        // open graph in fullscreen
        actionManager.$('.o_graph_buttons .o_button_switch').click();

        // go back using the breadcrumbs
        $('.o_control_panel .breadcrumb a').click();

        assert.verifySteps([
            [['categ_id', '=', 1]], // First rendering of dashboard view
            [['categ_id', '=', 1]], // Rendering of graph view in full screen
            [['categ_id', '=', 1]], // Second rendering of dashboard view
        ]);

        actionManager.destroy();
    });

    QUnit.test('getContext correctly returns graph subview context', function (assert) {
        assert.expect(2);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="graph" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                    '</graph>',
            },
        });

        assert.deepEqual(dashboard.getContext().graph, {
            graph_mode: 'bar',
            graph_measure: '__count__',
            graph_groupbys: ['categ_id'],
        }, "context should be correct");

        dashboard.$('li[data-field="sold"] a').click(); // change measure
        dashboard.$('button[data-mode="line"]').click(); // change mode

        assert.deepEqual(dashboard.getContext().graph, {
            graph_mode: 'line',
            graph_measure: 'sold',
            graph_groupbys: ['categ_id'],
        }, "context should be correct");

        dashboard.destroy();
    });
    QUnit.test('getContext correctly returns pivot subview context', function (assert) {
        assert.expect(2);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="pivot" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,pivot': '<pivot>' +
                        '<field name="categ_id" type="row"/>' +
                    '</pivot>',
            },
        });

        assert.deepEqual(dashboard.getContext().pivot, {
            pivot_column_groupby: [],
            pivot_measures: ['__count'],
            pivot_row_groupby: ['categ_id'],
        }, "context should be correct");

        dashboard.$('li[data-field="sold"] a').click(); // change measure
        dashboard.$('.o_pivot_flip_button').click(); // change mode

        assert.deepEqual(dashboard.getContext().pivot, {
            pivot_column_groupby: ['categ_id'],
            pivot_measures: ['__count', 'sold'],
            pivot_row_groupby: [],
        }, "context should be correct");

        dashboard.destroy();
    });

    QUnit.test('correctly uses graph_ keys from the context', function (assert) {
        assert.expect(4);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="graph" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.deepEqual(args.kwargs.fields, ['categ_id', 'untaxed'],
                        "should fetch data for untaxed");
                }
                return this._super.apply(this, arguments);
            },
            viewOptions: {
                context: {
                    graph: {
                        graph_measure: 'untaxed',
                        graph_mode: 'line',
                        graph_groupbys: ['categ_id'],
                    }
                },
            },
        });

        // check mode
        assert.strictEqual(dashboard.renderer.subControllers.graph.renderer.state.mode,
            "line", "should be in line chart mode");
        assert.notOk(dashboard.$('button[data-mode="bar"]').hasClass('active'),
            'bar chart button should not be active');
        assert.ok(dashboard.$('button[data-mode="line"]').hasClass('active'),
            'line chart button should be active');

        dashboard.destroy();
    });

    QUnit.test('correctly uses pivot_ keys from the context', function (assert) {
        assert.expect(7);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="pivot" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,pivot': '<pivot>' +
                        '<field name="categ_id" type="col"/>' +
                        '<field name="untaxed" type="measure"/>' +
                '</pivot>',
            },
            viewOptions: {
                context: {
                    pivot: {
                        pivot_measures: ['sold'],
                        pivot_column_groupby: ['categ_id'],
                        pivot_row_groupby: ['categ_id'],
                    }
                },
            },
        });

        assert.strictEqual(dashboard.$('thead .o_pivot_header_cell_opened').length, 1,
            "column: should have one opened header");
        assert.strictEqual(dashboard.$('thead .o_pivot_header_cell_closed:contains(First)').length, 1,
            "column: should display one closed header with 'First'");
        assert.strictEqual(dashboard.$('thead .o_pivot_header_cell_closed:contains(Second)').length, 1,
            "column: should display one closed header with 'Second'");

        assert.strictEqual(dashboard.$('tbody .o_pivot_header_cell_opened').length, 1,
            "row: should have one opened header");
        assert.strictEqual(dashboard.$('tbody .o_pivot_header_cell_closed:contains(First)').length, 1,
            "row: should display one closed header with 'xphone'");
        assert.strictEqual(dashboard.$('tbody .o_pivot_header_cell_closed:contains(First)').length, 1,
            "row: should display one closed header with 'xpad'");

        assert.strictEqual(dashboard.$('tbody tr:first td:nth(3)').text(), '8.00',
            "selected measure should be foo, with total 32");

        dashboard.destroy();
    });

    QUnit.test('correctly uses graph_ keys from the context (at reload)', function (assert) {
        assert.expect(3);

        var dashboard = createView({
            View: DashboardView,
            model: 'test_report',
            data: this.data,
            arch: '<dashboard><view type="graph" ref="some_xmlid"/></dashboard>',
            archs: {
                'test_report,some_xmlid,graph': '<graph>' +
                        '<field name="categ_id"/>' +
                        '<field name="sold" type="measure"/>' +
                    '</graph>',
            },
            mockRPC: function (route, args) {
                if (args.method === 'read_group') {
                    assert.step(args.kwargs.fields);
                }
                return this._super.apply(this, arguments);
            },
        });

        dashboard.reload({
            context: {
                graph: {
                    graph_measure: 'untaxed',
                    graph_mode: 'line',
                    graph_groupbys: ['categ_id'],
                },
            },
        });

        assert.verifySteps([
            ['categ_id', 'sold'], // first load
            ['categ_id', 'untaxed'], // reload
        ]);

        dashboard.destroy();
    });
});

});