odoo.define('web_studio.ViewEditorManager_tests', function (require) {
"use strict";

var concurrency = require('web.concurrency');
var ListRenderer = require('web.ListRenderer');
var testUtils = require("web.test_utils");
var Widget = require('web.Widget');

var createViewEditorManager = function (params) {
    var $target = $('#qunit-fixture');
    if (params.debug) {
        $target = $('body');
    }

    // reproduce the DOM environment of Studio
    var $web_client = $('<div>').addClass('o_web_client o_in_studio').appendTo($target);
    var $content = $('<div>').addClass('o_content').appendTo($web_client);
    var $client_action = $('<div>').addClass('o_web_studio_client_action').appendTo($content);

    var widget = new Widget();
    params.mockRPC = params.mockRPC || function(route, args) {
        if (route === '/web_studio/get_default_value') {
            return $.when({});
        }
        return this._super(route, args);
    };
    var mockServer = testUtils.addMockEnvironment(widget, params);
    var fieldsView = mockServer.fieldsViewGet(params.arch, params.model);
    var env = {
        modelName: params.model,
        ids: 'res_id' in params ? [params.res_id] : undefined,
        currentId: 'res_id' in params ? params.res_id : undefined,
        domain: params.domain || [],
        context: params.context || {},
        groupBy: params.groupBy || [],
    };
    var vem = new ViewEditorManager(widget, {
        fields_view: fieldsView,
        view_env: env,

    });
    vem.appendTo($client_action);
    return vem;
};

var ViewEditorManager = require('web_studio.ViewEditorManager');

QUnit.module('Studio', {
    beforeEach: function () {
        this.data = {
            coucou: {
                fields: {
                    display_name: {
                        string: "Display Name",
                        type: "char"
                    },
                },
            },
        };
    }
}, function () {

    QUnit.module('ViewEditorManager');

    QUnit.test('list editor sidebar', function(assert) {
        assert.expect(5);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree/>",
        });

        assert.strictEqual(vem.$('.o_web_studio_sidebar').length, 1,
            "there should be a sidebar");
        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_new').hasClass('active'),
            "the Add tab should be active in list view");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('.o_web_studio_field_type_container').length, 2,
            "there should be two sections in Add (new & existing fields");

        vem.$('.o_web_studio_sidebar').find('.o_web_studio_view').click();

        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_view').hasClass('active'),
            "the View tab should now be active");
        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_properties').hasClass('disabled'),
            "the Properties tab should now be disabled");

        vem.destroy();
    });

    QUnit.test('empty list editor', function(assert) {
        assert.expect(5);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree/>",
        });

        assert.strictEqual(vem.view_type, 'list',
            "view type should be list");
        assert.strictEqual(vem.$('.o_web_studio_list_view_editor').length, 1,
            "there should be a list editor");
        assert.strictEqual(vem.$('.o_web_studio_list_view_editor table thead th.o_web_studio_hook').length, 1,
            "there should be one hook");
        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 0,
            "there should be no node");
        assert.strictEqual(vem.$('.o_web_studio_sidebar .o_web_studio_existing_fields').children().length, 3,
            "there should be one available field (id, name, display_name)");

        vem.destroy();
    });

    QUnit.test('list editor', function(assert) {
        assert.expect(3);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='display_name'/></tree>",
        });

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "there should be one node");
        assert.strictEqual(vem.$('table thead th.o_web_studio_hook').length, 2,
            "there should be two hooks (before & after the field)");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('.o_web_studio_existing_fields').children().length, 2,
            "there should be two available fields (id, name)");

        vem.destroy();
    });

    QUnit.test('invisible list editor', function(assert) {
        assert.expect(4);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='display_name' invisible='1'/></tree>",
        });

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 0,
            "there should be no node");
        assert.strictEqual(vem.$('table thead th.o_web_studio_hook').length, 1,
            "there should be one hook");

        // click on show invisible
        vem.$('.o_web_studio_sidebar').find('.o_web_studio_view').click();
        vem.$('.o_web_studio_sidebar').find('input#show_invisible').click();

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "there should be one node (the invisible one)");
        assert.strictEqual(vem.$('table thead th.o_web_studio_hook').length, 2,
            "there should be two hooks (before & after the field)");

        vem.destroy();
    });

    QUnit.test('list editor field', function(assert) {
        assert.expect(5);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='display_name'/></tree>",
        });

        // click on the field
        vem.$('.o_web_studio_list_view_editor [data-node-id]').click();

        assert.ok(vem.$('.o_web_studio_list_view_editor [data-node-id]').hasClass('o_clicked'),
            "the column should have the clicked style");

        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_properties').hasClass('active'),
            "the Properties tab should now be active");
        assert.strictEqual(vem.$('.o_web_studio_sidebar_content.o_display_field').length, 1,
            "the sidebar should now display the field properties");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('input[name="string"]').val(), "Display Name",
            "the label in sidebar should be Display Name");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('select[name="widget"]').val(), "",
            "the widget in sidebar should be emtpy");

        vem.destroy();
    });

    QUnit.test('empty form editor', function(assert) {
        assert.expect(4);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<form/>",
        });

        assert.strictEqual(vem.view_type, 'form',
            "view type should be form");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor').length, 1,
            "there should be a form editor");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor [data-node-id]').length, 0,
            "there should be no node");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_web_studio_hook').length, 0,
            "there should be no hook");

        vem.destroy();
    });

    QUnit.test('form editor', function(assert) {
        assert.expect(6);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<form>" +
                    "<sheet>" +
                        "<field name='display_name'/>" +
                    "</sheet>" +
                "</form>",
        });

        assert.strictEqual(vem.$('.o_web_studio_form_view_editor [data-node-id]').length, 1,
            "there should be one node");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_web_studio_hook').length, 1,
            "there should be one hook");

        vem.$('.o_web_studio_form_view_editor [data-node-id]').click();

        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_properties').hasClass('active'),
            "the Properties tab should now be active");
        assert.strictEqual(vem.$('.o_web_studio_sidebar_content.o_display_field').length, 1,
            "the sidebar should now display the field properties");
        assert.ok(vem.$('.o_web_studio_form_view_editor [data-node-id]').hasClass('o_clicked'),
            "the column should have the clicked style");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('select[name="widget"]').val(), "",
            "the widget in sidebar should be empty");

        vem.destroy();
    });

    QUnit.test('invisible form editor', function(assert) {
        assert.expect(6);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<form>" +
                    "<sheet>" +
                        "<field name='display_name' invisible='1'/>" +
                    "</sheet>" +
                "</form>",
        });

        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_invisible_modifier[data-node-id]').length, 1,
            "there should be one invisible node");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor [data-node-id]:not(.o_invisible_modifier)').length, 0,
            "there should be no visible node");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_web_studio_hook').length, 1,
            "there should be one hook");

        // click on show invisible
        vem.$('.o_web_studio_sidebar').find('.o_web_studio_view').click();
        vem.$('.o_web_studio_sidebar').find('input#show_invisible').click();

        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_web_studio_show_invisible[data-node-id]').length, 1,
            "there should be one visible node (the invisible one)");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_invisible_modifier[data-node-id]').length, 0,
            "there should be no invisible node");
        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .o_web_studio_hook').length, 1,
            "there should be one hook");

        vem.destroy();
    });

    QUnit.test('form editor - chatter edition', function(assert) {
        assert.expect(5);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<form>" +
                    "<sheet>" +
                        "<field name='display_name'/>" +
                    "</sheet>" +
                    "<div class='oe_chatter'/>" +
                "</form>",
            mockRPC: function(route, args) {
                if (route === '/web_studio/get_default_value') {
                    return $.when({});
                }
                if (route === '/web_studio/get_email_alias') {
                    return $.when({email_alias: 'coucou'});
                }
                return this._super(route, args);
            },
        });

        assert.strictEqual(vem.$('.o_web_studio_form_view_editor .oe_chatter[data-node-id]').length, 1,
            "there should be a chatter node");

        // click on the chatter
        vem.$('.o_web_studio_form_view_editor .oe_chatter[data-node-id]').click();

        assert.ok(vem.$('.o_web_studio_sidebar .o_web_studio_properties').hasClass('active'),
            "the Properties tab should now be active");
        assert.strictEqual(vem.$('.o_web_studio_sidebar_content.o_display_chatter').length, 1,
            "the sidebar should now display the chatter properties");
        assert.ok(vem.$('.o_web_studio_form_view_editor .oe_chatter[data-node-id]').hasClass('o_clicked'),
            "the chatter should have the clicked style");
        assert.strictEqual(vem.$('.o_web_studio_sidebar input[name="email_alias"]').val(), "coucou",
            "the email alias in sidebar should be fetched");

        vem.destroy();
    });

    QUnit.test('empty kanban editor', function(assert) {
        assert.expect(4);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<kanban>" +
                    "<templates><t t-name='kanban-box'/></templates>" +
                "</kanban>",
        });

        assert.strictEqual(vem.view_type, 'kanban',
            "view type should be kanban");
        assert.strictEqual(vem.$('.o_web_studio_kanban_view_editor').length, 1,
            "there should be a kanban editor");
        assert.strictEqual(vem.$('.o_web_studio_kanban_view_editor [data-node-id]').length, 0,
            "there should be no node");
        assert.strictEqual(vem.$('.o_web_studio_kanban_view_editor .o_web_studio_hook').length, 0,
            "there should be no hook");

        vem.destroy();
    });

    QUnit.test('kanban editor', function(assert) {
        assert.expect(13);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<kanban>" +
                    "<templates>" +
                        "<t t-name='kanban-box'>" +
                            "<div class='o_kanban_record'>" +
                                "<field name='display_name'/>" +
                            "</div>" +
                        "</t>" +
                    "</templates>" +
                "</kanban>",
        });

        assert.strictEqual(vem.$('.o_web_studio_kanban_view_editor [data-node-id]').length, 1,
            "there should be one node");
        assert.ok(vem.$('.o_web_studio_kanban_view_editor [data-node-id]').hasClass('o_web_studio_widget_empty'),
            "the empty node should have the empty class");
        assert.strictEqual(vem.$('.o_web_studio_kanban_view_editor .o_web_studio_hook').length, 1,
            "there should be one hook");
        assert.strictEqual(vem.$('.o_kanban_record .o_web_studio_add_kanban_tags').length, 1,
            "there should be the hook for tags");
        assert.strictEqual(vem.$('.o_kanban_record .o_web_studio_add_dropdown').length, 1,
            "there should be the hook for dropdown");
        assert.strictEqual(vem.$('.o_kanban_record .o_web_studio_add_priority').length, 1,
            "there should be the hook for priority");
        assert.strictEqual(vem.$('.o_kanban_record .o_web_studio_add_kanban_image').length, 1,
            "there should be the hook for image");

        vem.$('.o_web_studio_kanban_view_editor [data-node-id]').click();

        assert.ok(vem.$('.o_web_studio_sidebar').find('.o_web_studio_properties').hasClass('active'),
            "the Properties tab should now be active");
        assert.strictEqual(vem.$('.o_web_studio_sidebar_content.o_display_field').length, 1,
            "the sidebar should now display the field properties");
        assert.ok(vem.$('.o_web_studio_kanban_view_editor [data-node-id]').hasClass('o_clicked'),
            "the field should have the clicked style");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('select[name="widget"]').val(), "",
            "the widget in sidebar should be empty");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('select[name="display"]').val(), "false",
            "the display attribute should be Default");
        assert.strictEqual(vem.$('.o_web_studio_sidebar').find('input[name="string"]').val(), "Display Name",
            "the field should have the label Display Name in the sidebar");

        vem.destroy();
    });

    QUnit.test('empty search editor', function(assert) {
        assert.expect(6);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<search/>",
        });

        assert.strictEqual(vem.view_type, 'search',
            "view type should be search");
        assert.strictEqual(vem.$('.o_web_studio_search_view_editor').length, 1,
            "there should be a search editor");
        assert.strictEqual(vem.$('.o_web_studio_search_autocompletion_fields.table tbody tr.o_web_studio_hook').length, 1,
            "there should be one hook in the autocompletion fields");
        assert.strictEqual(vem.$('.o_web_studio_search_filters.table tbody tr.o_web_studio_hook').length, 1,
            "there should be one hook in the filters");
        assert.strictEqual(vem.$('.o_web_studio_search_group_by.table tbody tr.o_web_studio_hook').length, 1,
            "there should be one hook in the group by");
        assert.strictEqual(vem.$('.o_web_studio_search_view_editor [data-node-id]').length, 0,
            "there should be no node");
        vem.destroy();
    });

    QUnit.test('search editor', function(assert) {
        assert.expect(9);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<search>" +
                    "<field name='display_name'/>" +
                    "<filter string='My Name' " +
                        "name='my_name' " +
                        "domain='[(\"display_name\",\"=\",coucou)]'" +
                    "/>" +
                    "<filter string='My Name2' " +
                        "name='my_name2' " +
                        "domain='[(\"display_name\",\"=\",coucou2)]'" +
                    "/>" +
                    "<group expand='0' string='Group By'>" +
                        "<filter name='groupby_display_name' " +
                        "domain='[]' context=\"{'group_by':'display_name'}\"/>" +
                    "</group>" +
                "</search>",
        });

        assert.strictEqual(vem.view_type, 'search',
            "view type should be search");
        assert.strictEqual(vem.$('.o_web_studio_search_view_editor').length, 1,
            "there should be a search editor");
        assert.strictEqual(vem.$('.o_web_studio_search_autocompletion_fields.table tbody tr.o_web_studio_hook').length, 2,
            "there should be two hooks in the autocompletion fields");
        assert.strictEqual(vem.$('.o_web_studio_search_filters.table tbody tr.o_web_studio_hook').length, 3,
            "there should be three hook in the filters");
        assert.strictEqual(vem.$('.o_web_studio_search_group_by.table tbody tr.o_web_studio_hook').length, 2,
            "there should be two hooks in the group by");
        assert.strictEqual(vem.$('.o_web_studio_search_autocompletion_fields.table [data-node-id]').length, 1,
            "there should be 1 node in the autocompletion fields");
        assert.strictEqual(vem.$('.o_web_studio_search_filters.table [data-node-id]').length, 2,
            "there should be 2 nodes in the filters");
        assert.strictEqual(vem.$('.o_web_studio_search_group_by.table [data-node-id]').length, 1,
            "there should be 1 nodes in the group by");
        assert.strictEqual(vem.$('.o_web_studio_search_view_editor [data-node-id]').length, 4,
            "there should be 4 nodes");

        vem.destroy();
    });

    QUnit.test('empty pivot editor', function(assert) {
        assert.expect(3);

        this.data.coucou.records = [{
            id: 1,
            display_name: 'coucou',
        }];

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<pivot/>",
        });

        assert.strictEqual(vem.view_type, 'pivot',
            "view type should be pivot");
        assert.strictEqual(vem.$('.o_web_studio_view_renderer .o_pivot').length, 1,
            "there should be a pivot renderer");
        assert.strictEqual(vem.$('.o_web_studio_view_renderer > .o_pivot > table').length, 1,
            "the table should be the direct child of pivot");

        vem.destroy();
    });

    QUnit.test('empty graph editor', function(assert) {
        var done = assert.async();
        assert.expect(3);

        this.data.coucou.records = [{
            id: 1,
            display_name: 'coucou',
        }];

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<graph/>",
        });

        assert.strictEqual(vem.view_type, 'graph',
            "view type should be graph");
        return concurrency.delay(0).then(function () {
            assert.strictEqual(vem.$('.o_web_studio_view_renderer .o_graph').length, 1,
                "there should be a graph renderer");
            assert.strictEqual(vem.$('.o_web_studio_view_renderer > .o_graph > .o_graph_svg_container > svg').length, 1,
                "the graph should be the direct child of its container");
            vem.destroy();
            done();
        });
    });

    QUnit.test('error during tree rendering: undo', function(assert) {
        assert.expect(4);

        var fieldsView;
        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='id'/></tree>",
            mockRPC: function (route) {
                if (route === '/web_studio/get_default_value') {
                    return $.when({});
                }
                if (route === '/web_studio/edit_view') {
                    // the server sends the arch in string but it's post-processed
                    // by the ViewEditorManager
                    fieldsView.arch = "<tree><field name='id'/></tree>";
                    return $.when({
                        fields_views: {
                            list: fieldsView,
                        }
                    });
                }
                return this._super.apply(this, arguments);
            },
        });

        testUtils.intercept(vem, 'studio_error', function (event) {
            assert.strictEqual(event.data.error, 'view_rendering',
                "should have raised an error");
        });

        // used to generate the new fields view in mockRPC
        fieldsView = $.extend(true, {}, vem.fields_view);

        // make the rendering crashes only the first time (the operation will
        // be undone and we will re-render with the old arch the second time)
        var oldRenderView = ListRenderer.prototype._renderView;
        var firstExecution = true;
        ListRenderer.prototype._renderView = function () {
            if (firstExecution) {
                firstExecution = false;
                throw "Error during rendering";
            } else {
                return oldRenderView.apply(this, arguments);
            }
        };

        // delete a field to generate a view edition
        vem.$('.o_web_studio_list_view_editor [data-node-id]').click();
        vem.$('.o_web_studio_sidebar .o_web_studio_remove').click();
        $('.modal-dialog .btn-primary').click();

        assert.strictEqual($('.o_web_studio_view_renderer').length, 1,
            "there should only be one renderer");
        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "the view should be back as normal with 1 field");
        assert.strictEqual(vem.$('.o_web_studio_sidebar_content.o_display_field').length, 1,
            "the sidebar should now display the field properties");

        ListRenderer.prototype._renderView = oldRenderView;

        vem.destroy();
    });

    QUnit.test('add a monetary field without currency_id', function(assert) {
        assert.expect(3);

        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='display_name'/></tree>",
            mockRPC: function (route) {
                if (route === '/web_studio/edit_view') {
                    assert.ok(false, "should not edit the view");
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "there should be one node");

        testUtils.dragAndDrop(vem.$('.o_web_studio_new_fields .o_web_studio_field_monetary'), $('.o_web_studio_hook'));

        assert.strictEqual($('.modal-body').text(), "This field type cannot be dropped on this model.",
            "this should trigger an alert");

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "there should still be one node");

        vem.destroy();
    });

    QUnit.test('add a monetary field with currency_id', function(assert) {
        assert.expect(3);

        this.data.coucou.fields.currency_id = {
            string: "Currency",
            type: 'many2one',
            relation: "res.currency",
        };

        var fieldsView;
        var vem = createViewEditorManager({
            data: this.data,
            model: 'coucou',
            arch: "<tree><field name='display_name'/></tree>",
            mockRPC: function (route) {
                if (route === '/web_studio/edit_view') {
                    // the server sends the arch in string but it's post-processed
                    // by the ViewEditorManager
                    assert.ok(true, "should edit the view to add the monetary field");
                    fieldsView.arch = "<tree><field name='display_name'/><field name='currency_id'/></tree>";
                    return $.when({
                        fields_views: {
                            list: fieldsView,
                        },
                    });
                }
                return this._super.apply(this, arguments);
            },
        });

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 1,
            "there should be one node");

        // used to generate the new fields view in mockRPC
        fieldsView = $.extend(true, {}, vem.fields_view);

        testUtils.dragAndDrop(vem.$('.o_web_studio_new_fields .o_web_studio_field_monetary'), $('.o_web_studio_hook'));

        assert.strictEqual(vem.$('.o_web_studio_list_view_editor [data-node-id]').length, 2,
            "there should be two nodes");

        vem.destroy();
    });
});

});
