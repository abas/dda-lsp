odoo.define('web_studio.ViewEditorManager', function (require) {
"use strict";

var concurrency = require('web.concurrency');
var core = require('web.core');
var data_manager = require('web.data_manager');
var Dialog = require('web.Dialog');
var framework = require('web.framework');
var session = require('web.session');
var view_registry = require('web.view_registry');
var Widget = require('web.Widget');

var bus = require('web_studio.bus');

var CalendarEditor = require('web_studio.CalendarEditor');
var FormEditor = require('web_studio.FormEditor');
var GanttEditor = require('web_studio.GanttEditor');
var GraphEditor = require('web_studio.GraphEditor');
var GridEditor =require('web_studio.GridEditor');
var KanbanEditor = require('web_studio.KanbanEditor');
var ListEditor = require('web_studio.ListEditor');
var PivotEditor = require('web_studio.PivotEditor');
var SearchEditor = require('web_studio.SearchEditor');
var SearchRenderer = require('web_studio.SearchRenderer');

var NewButtonBoxDialog = require('web_studio.NewButtonBoxDialog');
var NewFieldDialog = require('web_studio.NewFieldDialog');
var utils = require('web_studio.utils');
var ViewEditorSidebar = require('web_studio.ViewEditorSidebar');
var XMLEditor = require('web_studio.XMLEditor');

var _t = core._t;
var QWeb = core.qweb;

var Editors = {
    form: FormEditor,
    kanban: KanbanEditor,
    list: ListEditor,
    grid: GridEditor,
    pivot: PivotEditor,
    graph: GraphEditor,
    calendar: CalendarEditor,
    gantt: GanttEditor,
    search: SearchEditor,
};

var ViewEditorManager = Widget.extend({
    className: 'o_web_studio_view_editor',
    custom_events: {
        'close_xml_editor': '_onCloseXMLEditor',
        'default_value_change': '_onDefaultValueChange',
        'drag_component' : '_onComponentDragged',
        'email_alias_change': '_onEmailAliasChange',
        'field_edition': '_onFieldEdition',
        'field_renamed': '_onFieldRenamed',
        'node_clicked': '_onNodeClicked',
        'open_defaults': '_onOpenDefaults',
        'open_field_form': '_onOpenFieldForm',
        'open_view_form': '_onOpenViewForm',
        'open_xml_editor': '_onOpenXMLEditor',
        'save_xml_editor': '_onSaveXMLEditor',
        'sidebar_tab_changed': '_onSidebarTabChanged',
        'toggle_form_invisible': '_onShowInvisibleToggled',
        'unselect_element': '_onUnselectElement',
        'view_change': '_onViewChange',
    },
    /**
     * @override
     * @param {Widget} parent
     * @param {Object} params
     * @param {Object} params.fields_view
     * @param {string} params.viewType
     * @param {Object} params.view_env - action environment shared between views
     *    (id, context, etc.)
     * @param {Object} [params.chatter_allowed]
     * @param {Object} [params.studio_view_id]
     * @param {Object} [params.studio_view_arch]
     */
    init: function (parent, params) {
        this._super.apply(this, arguments);

        this.fields_view = params.fields_view;
        this.view_id = this.fields_view.view_id;
        this.model_name = this.fields_view.model;

        this.fields = this._processFields(this.fields_view.fields);

        // do not take it from the fields_view as it directly comes from the
        // server and might be `tree` sometimes
        this.view_type = params.viewType;

        this.mode = 'edition';  // the other mode is 'rendering' in XML editor
        this.editor = undefined;
        this.sidebar = undefined;

        this.operations = [];
        this.operations_undone = [];

        this.renamingAllowedFields = []; // those fields can be renamed

        this.expr_attrs = {
            'field': ['name'],
            'label': ['for'],
            'page': ['name'],
            'group': ['name'],
            'div': ['name'],
            'filter': ['name'],
        };

        this.view_env = params.view_env;
        this.chatter_allowed = params.chatter_allowed;
        this.studio_view_id = params.studio_view_id;
        this.studio_view_arch = params.studio_view_arch;
        this.x2mEditorPath = params.x2mEditorPath || [];

        this._operationsMutex = new concurrency.Mutex();

        bus.on('undo_clicked', this, this.undo);
        bus.on('redo_clicked', this, this.redo);
    },
    /**
     * @override
     */
    start: function () {
        var self = this;
        return this._super.apply(this, arguments).then(function () {
            return self.instantiateEditor().then(function (editor) {
                var $editorFragment = $('<div>', {
                    class: 'o_web_studio_view_renderer',
                });
                self.editor = editor;
                self.editor.appendTo($editorFragment);
                $editorFragment.appendTo(self.$el);

                self.sidebar = self.instantiateSidebar();
                return self.sidebar.prependTo(self.$el);
            }).then(function () {
                if (self.x2mEditorPath.length) {
                    var currentX2m = self.x2mEditorPath.slice(-1)[0];
                    self.x2mEditorPath = self.x2mEditorPath.slice(0, -1);
                    var fields_view;
                    var x2mData;
                    if (self.x2mEditorPath.length) {
                        x2mData = self.x2mEditorPath.slice(-1)[0].x2mData;
                        fields_view = self._getX2mFieldsView();
                    }
                    return self._openX2mEditor(currentX2m.x2mField,
                        currentX2m.x2mViewType, true, fields_view, x2mData);
                }
                return $.when();
            });
        });
    },
    /**
     * @override
     */
    destroy: function () {
        bus.trigger('undo_not_available');
        bus.trigger('redo_not_available');
        this._super.apply(this, arguments);
    },

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Apply the changes, i.e. the stack of operations on the Studio view.
     *
     * @param {Boolean} remove_last_op
     * @param {Boolean} from_xml
     * @returns {Deferred}
     */
    applyChanges: function (remove_last_op, from_xml) {
        var self = this;

        var last_op = this.operations.slice(-1)[0];

        var def;
        if (from_xml) {
            def = this._operationsMutex.exec(this._editViewArch.bind(
                this,
                last_op.view_id,
                last_op.new_arch
            )).fail(function () {
                self.trigger_up('studio_error', {error: 'view_rendering'});
            });
        } else {
            def = this._operationsMutex.exec(this._editView.bind(
                this,
                this.view_id,
                this.studio_view_arch,
                _.filter(this.operations, function (el) {return el.type !== 'replace_arch'; })
            ));
        }
        return def.then(function (result) {
            if (!result.fields_views) {
                // the operation can't be applied
                self.trigger_up('studio_error', {error: 'wrong_xpath'});
                return self.undo(true).then(function () {
                    return $.Deferred().reject();
                });
            }

            // the studio_view could have been created at the first edition so
            // studio_view_id must be updated
            self.studio_view_id = result.studio_view_id;

            if (self.x2mField) {
                self.view_type = self.mainViewType;
            }

            // NOTE: fields & fields_view are from the base model here.
            // fields will be updated accordingly if editing a x2m (see
            // @_setX2mParameters).
            self.fields = self._processFields(result.fields);
            self.fields_view = result.fields_views[self.view_type];
            // TODO: this processing is normally done in data_manager so we need
            // to duplicate it here ; it should be moved in init of
            // abstract_view to avoid the duplication
            self.fields_view.viewFields = self.fields_view.fields;
            self.fields_view.fields = result.fields;

            // As the studio view arch is stored in this widget, if this view
            // is updated directly with the XML editor, the arch should be updated.
            // The operations may not have any sense anymore so they are dropped.
            if (from_xml && last_op.view_id === self.studio_view_id) {
                self.studio_view_arch = last_op.new_arch;
                self.operations = [];
                self.operations_undone = [];
            }
            if (remove_last_op) { self.operations.pop(); }

            // fields and fields_view has been updated so let's update everything
            // (i.e. the sidebar which displays the 'Existing Fields', etc.)
            if (self.x2mField) {
                return self._setX2mParameters();
            }
            return $.when();
        })
        .then(self.updateEditor.bind(self))
        .then(function () {
            self.updateButtons();
            if (self.sidebar.state.mode !== 'properties') {
                // TODO: the sidebar will be updated by clicking on the node
                self.updateSidebar(self.sidebar.state.mode);
            }
        });
    },
    /**
     * @param {Object} op
     * @returns {Deferred}
     */
    do: function (op) {
        // If we are editing an x2m field, we specify the xpath needed in front
        // of the one generated by the default route.
        if (this.x2mField && op.target) {
            this._setSubViewXPath(op);
        }
        this.operations.push(op);
        this.operations_undone = [];

        return this.applyChanges(false, op.type === 'replace_arch');
    },
    /**
     * @returns {Deferred}
     */
    instantiateEditor: function (params) {
        params = params || {};
        var fields_view = this.x2mField ? this._getX2mFieldsView() : this.fields_view;

        var def;
        // Different behaviour for the search view because
        // it's not defined as a "real view", no inherit to abstract view.
        // The search view in studio has its own renderer.
        if (this.view_type === 'search') {
            if (this.mode === 'edition') {
                this.view = new Editors.search(this, fields_view);
            } else {
                this.view = new SearchRenderer(this, fields_view);
            }
            def = $.when(this.view);
        } else {
            var View = view_registry.get(this.view_type);
            this.view = new View(fields_view, this.view_env);
            if (this.mode === 'edition') {
                var Editor = Editors[this.view_type];
                var chatterAllowed = this.x2mField ? false : this.chatter_allowed;
                var editorParams = _.defaults(params, {
                    mode: 'readonly',
                    chatter_allowed: chatterAllowed,
                    show_invisible: this.sidebar && this.sidebar.state.show_invisible,
                    arch: this.view.arch,
                });

                if (this.view_type === 'list') {
                    editorParams.hasSelectors = false;
                }
                def = this.view.createStudioEditor(this, Editor, editorParams);
            } else {
                def = this.view.createStudioRenderer(this, {
                    mode: 'readonly',
                });
            }
        }
        return def;
    },
    /**
     * @private
     * @returns {Widget} A ViewEditorSidebar
     */
    instantiateSidebar: function (state) {

        var defaultMode = this._getDefaultSidebarMode();
        state = _.defaults(state || {}, {
            mode: defaultMode,
            attrs: defaultMode === 'view' ? this.view.arch.attrs : {},
        });
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        var params = {
            view_type: this.view_type,
            model_name: modelName,
            fields: this.fields,
            renamingAllowedFields: this.renamingAllowedFields,
            state: state,
            isEditingX2m: !!this.x2mField,
        };

        if (_.contains(['list', 'form', 'kanban'], this.view_type)) {
            var fields_in_view = _.pick(this.fields, this.editor.state.getFieldNames());
            var fields_not_in_view = _.omit(this.fields, this.editor.state.getFieldNames());
            params.fields_not_in_view = fields_not_in_view;
            params.fields_in_view = fields_in_view;
        } else if (this.view_type === 'search') {
            // we return all the model fields since it's possible
            // to have multiple times the same field defined in the search view.
            params.fields_not_in_view = this.fields;
            params.fields_in_view = [];
        }

        return new ViewEditorSidebar(this, params);
    },
    /**
     * Redo the last operation.
     *
     * @returns {Deferred}
     */
    redo: function () {
        if (!this.operations_undone.length) {
            return;
        }
        var op = this.operations_undone.pop();
        this.operations.push(op);

        return this.applyChanges(false, op.type === 'replace_arch');
    },
    /**
     * Update the undo/redo button according to the operation stack.
     */
    updateButtons: function () {
        // Undo button
        if (this.operations.length) {
            bus.trigger('undo_available');
        } else {
            bus.trigger('undo_not_available');
        }

        // Redo button
        if (this.operations_undone.length) {
            bus.trigger('redo_available');
        } else {
            bus.trigger('redo_not_available');
        }
    },
    /**
     * @param {Object} options
     * @returns {Deferred}
     */
    updateEditor: function (options) {
        var self = this;
        var oldEditor;
        var renderer_scrolltop = this.$el.scrollTop();
        var local_state = this.editor ? this.editor.getLocalState() : false;

        oldEditor = this.editor;
        return this.instantiateEditor(options).then(function (editor) {
            var def = $.Deferred();
            var fragment = document.createDocumentFragment();
            try {
                def = editor.appendTo(fragment);
            } catch (e) {
                self.trigger_up('studio_error', {error: 'view_rendering'});
                self.undo(true);
                def.reject();
            }
            return $.when(def).then(function () {
                self.$('.o_web_studio_view_renderer').append(fragment);
                self.editor = editor;
                oldEditor.destroy();

                // restore previous state
                self.$el.scrollTop(renderer_scrolltop);
                if (local_state) {
                    self.editor.setLocalState(local_state);
                }
            });
        });
    },
    /**
     * Re-render the sidebar and destroy the old while keeping the scroll
     * position.
     * If mode is not specified, the sidebar will be renderered with the same
     * state.
     *
     * @param {String} mode
     * @param {Object} node
     * @returns {Deferred}
     */
    updateSidebar: function (mode, node) {
        var self = this;

        // TODO: scroll top is calculated to 'o_web_studio_sidebar_content'
        var scrolltop = this.sidebar.$el.scrollTop();

        var def;

        var newState;
        if (mode) {
            newState = {
                renamingAllowedFields: this.renamingAllowedFields,
                mode: mode,
                show_invisible: this.sidebar.state.show_invisible,
            };
        } else {
            newState = this.sidebar.state;
        }
        switch (mode) {
            case 'view':
                newState = _.extend(newState, {
                    attrs: this.view.arch.attrs,
                });
                break;
            case 'new':
                break;
            case 'properties':
                var attrs;
                if (node.tag === 'field' && this.view_type !== 'search') {
                    var viewType = this.editor.state.viewType;
                    attrs = this.editor.state.fieldsInfo[viewType][node.attrs.name];
                } else {
                    attrs = node.attrs;
                }
                newState = _.extend(newState, {
                    node: node,
                    attrs: attrs,
                });

                var modelName = this.x2mModel ? this.x2mModel : this.model_name;
                if (node.tag === 'field') {
                    def = this._getDefaultValue(modelName, node.attrs.name);
                }
                if (node.tag === 'div' && node.attrs.class === 'oe_chatter') {
                    def = this._getEmailAlias(modelName);
                }
                break;
        }

        return $.when(def).then(function (result) {
            _.extend(newState, result);
            self.sidebar.destroy();
            self.sidebar = self.instantiateSidebar(newState);

            // Note: the sidebar rendering is considered synchronous here.
            // If this changes, we will need to handle it correctly (to avoid
            // any flickering) by using a dropmisorder for `def` and put this
            // handler in a mutex.
            self.sidebar.prependTo(self.$el);
            self.sidebar.$el.scrollTop(scrolltop);

            // the XML editor replaces the sidebar in this case
            if (self.mode === 'rendering') {
                self.sidebar.$el.detach();
            }
        });
    },
    /**
     * Undo the last operation.
     *
     * @param {Boolean} forget
     * @returns {Deferred}
     */
    undo: function (forget) {
        if (!this.operations.length) {
            return $.Deferred().resolve();
        }
        var op = this.operations.pop();
        if (!forget) {
            this.operations_undone.push(op);
        }

        if (op.type === 'replace_arch') {
            // as the whole arch has been replace (A -> B),
            // when undoing it, the operation (B -> A) is added and
            // removed just after.
            var undo_op = jQuery.extend(true, {}, op);
            undo_op.old_arch = op.new_arch;
            undo_op.new_arch = op.old_arch;
            this.operations.push(undo_op);
            return this.applyChanges(true, true);
        } else {
            return this.applyChanges(false, false);
        }
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * @private
     * @param {String} type
     */
    _addButton: function (data) {
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        var dialog = new NewButtonBoxDialog(this, modelName).open();
        dialog.on('saved', this, function (result) {
            if (data.add_buttonbox) {
                this.operations.push({type: 'buttonbox'});
            }
            this.do({
                type: data.type,
                target: {
                    tag: 'div',
                    attrs: {
                        class: 'oe_button_box',
                    }
                },
                position: 'inside',
                node: {
                    tag: 'button',
                    field: result.field_id,
                    string: result.string,
                    attrs: {
                        class: 'oe_stat_button',
                        icon: result.icon,
                    }
                },
            });
        });
    },
    /**
     * @private
     * @param {Object} data
     */
    _addChatter: function (data) {
        this.do({
            type: 'chatter',
            model: this.model_name,
            remove_message_ids: data.remove_message_ids,
            remove_follower_ids: data.remove_follower_ids,
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {String} position
     * @param {String} tag
     */
    _addElement: function (type, node, xpath_info, position, tag) {
        this.do({
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
            position: position,
            node: {
                tag: tag,
                attrs: {
                    name: 'studio_' + tag + '_' + utils.randomString(5),
                }
            },
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} field_description
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {String} position
     * @param {Object} new_attrs
     */
    _addField: function (type, field_description, node, xpath_info, position, new_attrs) {
        var self = this;
        var def_field_values;

        // The field doesn't exist: field_description is the definition of the new field.
        // No need to have field_description of an existing field
        if (field_description) {
            var modelName = this.x2mModel ? this.x2mModel : this.model_name;
            // "extend" avoids having the same reference in "this.operations"
            // We can thus modify it without editing previous existing operations
            field_description = _.extend({}, field_description, {
                name: 'x_studio_field_' + utils.randomString(5),
                model_name: modelName,
            });
            // Fields with requirements
            // Open Dialog to precise the required fields for this field.
            if (_.contains(['selection', 'one2many', 'many2one', 'many2many', 'related'], field_description.type)) {
                def_field_values = $.Deferred();
                var dialog = new NewFieldDialog(this, modelName, field_description, this.fields).open();
                dialog.on('field_default_values_saved', this, function (values) {
                    if (values.related && values.type === 'monetary') {
                        if (this._hasCurrencyField()) {
                            def_field_values.resolve(values);
                        }
                    } else {
                        def_field_values.resolve(values);
                    }
                    dialog.close();
                });
                dialog.on('closed', this, function () {
                    def_field_values.reject();
                });
            }
            if (field_description.type === 'monetary') {
                def_field_values = $.Deferred();
                if (this._hasCurrencyField()) {
                    def_field_values.resolve();
                } else {
                    def_field_values.reject();
                }
            }
        }
        // When the field values is selected, close the dialog and update the view
        $.when(def_field_values).then(function (values) {
            if (field_description) {
                self.renamingAllowedFields.push(field_description.name);
            }
            self.do({
                type: type,
                target: {
                    tag: node.tag,
                    attrs: _.pick(node.attrs, self.expr_attrs[node.tag]),
                    xpath_info: xpath_info,
                },
                position: position,
                node: {
                    tag: 'field',
                    attrs: new_attrs,
                    field_description: _.extend(field_description, values),
                },
            });
        }).fail(function () {
            self.updateEditor();
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {String} position
     * @param {Object} new_attrs
     */
    _addFilter: function (type, node, xpath_info, position, new_attrs) {
        this.do({
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
            position: position,
            node: {
                tag: 'filter',
                attrs: new_attrs,
            },
        });
    },
    /**
     * @private
     */
    _addKanbanDropdown: function () {
        this.do({
            type: 'kanban_dropdown',
        });
    },
    /**
     * @private
     * @param {Object} data
     */
    _addKanbanPriority: function (data) {
        this.do({
            type: 'kanban_priority',
            field: data.field,
        });
    },
    /**
     * @private
     * @param {Object} data
     */
    _addKanbanImage: function (data) {
        this.do({
            type: 'kanban_image',
            field: data.field,
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {String} position
     */
    _addPage: function (type, node, xpath_info, position) {
        this.do({
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
            position: position,
            node: {
                tag: 'page',
                attrs: {
                    string: 'New Page',
                    name: 'studio_page_' + utils.randomString(5),
                }
            },
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {String} position
     */
    _addSeparator: function (type, node, xpath_info, position) {
        this.do({
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
            position: position,
            node: {
                tag: 'separator',
                attrs: {
                    name: 'studio_separator_' + utils.randomString(5),
                },
            },
        });
    },
    /**
     * Find a currency field on the current model ; a monetary field can not be
     * added if such a field does not exist on the model.
     *
     * @private
     * @return {boolean} the presence of a currency field
     */
    _hasCurrencyField: function () {
        var currencyField = _.find(this.fields, function (field) {
            return field.type === 'many2one' && field.relation === 'res.currency' &&
                (field.name === 'currency_id' || field.name === 'x_currency_id');
        });
        if (!currencyField) {
            Dialog.alert(this, _t('This field type cannot be dropped on this model.'));
        }
        return !!currencyField;
    },
    /**
     * Makes a RPC to modify the studio view in order to add the x2m view
     * inline. This is done to avoid modifying the x2m default view.
     *
     * @private
     * @param {string} type
     * @param {string} field_name
     * @return {Deferred}
     */
    _createInlineView: function (type, field_name) {
        var self = this;
        var subviewType = type === 'list' ? 'tree' : type;
        // We build the correct xpath if we are editing a 'sub' subview
        var subviewXpath = this._getSubviewXpath(this.x2mEditorPath.slice(0, -1));
        var def = this._rpc({
            route: '/web_studio/create_inline_view',
            params: {
                model: this.x2mModel,
                view_id: this.view_id,
                field_name: field_name,
                subview_type: subviewType,
                subview_xpath: subviewXpath,
                context: session.user_context,
            },
        });
        return def
            .then(function (studio_view_arch) {
                // We clean the stack of operations because the edited view will change
                self.operations = [];
                self.studio_view_arch = studio_view_arch;
                var params = self.view.loadParams;
                return self.loadViews(
                    self.model_name,
                    params.context || {},
                    [[self.view_id, params.viewType]]
                );
            }).then(function (viewInfo) {
                self.fields_view = viewInfo[self.view_type];
                return self._instantiateX2mEditor();
            });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     * @param {Object} new_attrs
     */
    _editElementAttributes: function (type, node, xpath_info, new_attrs) {
        var newOp = {
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
            position: 'attributes',
            node: node,
            new_attrs: new_attrs,
        };
        if (node.tag === 'field' && new_attrs.string &&
            _.contains(this.renamingAllowedFields, node.attrs.name)) {
            if (this.x2mField) {
                this._setSubViewXPath(newOp);
            }
            this.operations.push(newOp);

            // find a new name that doesn't exist yet, acording to the label
            var baseName = 'x_studio_' + this._slugify(new_attrs.string);
            var newName = baseName;
            var index = 1;
            while (newName in this.fields) {
                newName = baseName + '_' + index;
                index++;
            }

            this._renameField(node.attrs.name, newName);
        } else {
            this.do(newOp);
        }
    },
    /**
     * The point of this function is to receive a list of customize operations
     * to do.
     *
     * @private
     * @param {Integer} view_id
     * @param {String} studio_view_arch
     * @param {Array} operations
     * @returns {Deferred}
     */
    _editView: function (view_id, studio_view_arch, operations) {
        core.bus.trigger('clear_cache');
        return this._rpc({
            route: '/web_studio/edit_view',
            params: {
                view_id: view_id,
                studio_view_arch: studio_view_arch,
                operations: operations,
                context: session.user_context,
            },
        });
    },
    /**
     * This is used when the view is edited with the XML editor: the whole arch
     * is replaced by a new one.
     *
     * @private
     * @param {Integer} view_id
     * @param {String} view_arch
     * @returns {Deferred}
     */
    _editViewArch: function (view_id, view_arch) {
        core.bus.trigger('clear_cache');
        return this._rpc({
            route: '/web_studio/edit_view_arch',
            params: {
                view_id: view_id,
                view_arch: view_arch,
                context: session.user_context,
            },
        });
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} new_attrs
     */
    _editViewAttributes: function (type, new_attrs) {
        this.do({
            type: type,
            target: {
                tag: this.view_type === 'list' ? 'tree' : this.view_type,
                isSubviewAttr: true,
            },
            position: 'attributes',
            new_attrs: new_attrs,
        });
    },
    /**
     * Enable kanban stages.
     * What it actually does:
     *  - create a new model Stage
     *  - create a new Many2one field in the current model related to it
     *  - set the `default_group_by` attribute on the view
     *
     *  @private
     */
    _enableStages: function () {
        var self = this;
        data_manager.invalidate();
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        this._rpc({
            route: '/web_studio/create_stages_model',
            params: {
                context: session.user_context,
                model_name: modelName,
            },
        }).then(function (relationID) {
            var fieldName = 'x_stage_id';
            self.do({
                type: 'add',
                target: {
                    tag: 'templates',
                },
                position: 'before',
                node: {
                    tag: 'field',
                    attrs: {},
                    field_description: {
                        name: fieldName,
                        field_description: _t('Stage'),
                        model_name: modelName,
                        type: 'many2one',
                        relation_id: relationID,
                    },
                },
            });

            self._editViewAttributes('attributes', {
                default_group_by: fieldName,
            });
        });
    },
    /**
     * @private
     * @param {String} model_name
     * @param {String} field_name
     * @returns {Deferred}
     */
    _getDefaultValue: function (model_name, field_name) {
        return this._rpc({
            route: '/web_studio/get_default_value',
            params: {
                model_name: model_name,
                field_name: field_name,
            },
        });
    },
    /**
     * @private
     */
    _getDefaultSidebarMode: function () {
        return _.contains(['form', 'list', 'search'], this.view_type) ? 'new' : 'view';
    },
    /**
     * @private
     * @param {String} model_name
     * @returns {Deferred}
     * @returns {Deferred}
     */
    _getEmailAlias: function (model_name) {
        return this._rpc({
            route: '/web_studio/get_email_alias',
            params: {
                model_name: model_name,
            },
        });
    },
    /**
     * @private
     * @param  {Array} x2mEditorPath
     * @return {String}
     */
    _getSubviewXpath: function (x2mEditorPath) {
        var subviewXpath = "";
        _.each(x2mEditorPath, function (x2mPath) {
            subviewXpath += "//field[@name='" + x2mPath.x2mField + "']";
            if (x2mPath.x2mViewType === 'list') {
                subviewXpath += '//tree';
            } else {
                subviewXpath += '//' + x2mPath.x2mViewType;
            }
        });
        return subviewXpath;
    },
    /**
     * Goes through the x2mEditorPath to get the current x2m fields_view
     *
     * @private
     * @return {Object} the fields_view of the x2m field
     */
    _getX2mFieldsView: function () {
        // this is a crappy way of processing the arch received as string
        // because we need a processed fields_view to find the x2m fields view
        var View = view_registry.get(this.mainViewType);
        var view = new View(this.fields_view, this.view_env);

        var fields_view = view.fieldsView;
        _.each(this.x2mEditorPath, function (step) {
            var x2mField = fields_view.fieldsInfo[step.view_type][step.x2mField];
            fields_view = x2mField.views[step.x2mViewType];
        });
        fields_view.model = this.x2mModel;
        return fields_view;
    },
    /**
     * Changes the environment variables before updating the editor
     * with the x2m information.
     *
     * @private
     * @return {Deferred}
     */
    _instantiateX2mEditor: function () {
        var self = this;
        this.mainViewType = this.view_type;
        return this._setX2mParameters().then(function () {
            return self.updateEditor();
        });
    },
    /**
     * Called when the x2m editor needs to be opened. Makes the check if an
     * inline view needs to be create or directly instantiate the x2m editor.
     *
     * @private
     * @param {string} fieldName x2m field name
     * @param {string} viewType x2m viewtype being edited
     * @param {boolean} fromBreadcrumb
     * @param {object} fieldsView
     * @param {object} x2mData
     * @return {Deferred}
     */
    _openX2mEditor: function (fieldName, viewType, fromBreadcrumb, fieldsView, x2mData) {
        var self = this;
        this.editor.unselectedElements();
        this.x2mField = fieldName;
        this.x2mViewType = viewType;
        var fields = this.fields;
        var fieldsInfo = this.editor.state.fieldsInfo;
        if (fieldsView) {
            fields = fieldsView.fields;
            fieldsInfo = fieldsView.fieldsInfo;
        }
        this.x2mModel = fields[this.x2mField].relation;

        var data = x2mData || this.editor.state.data[this.x2mField];
        if (viewType === 'form' && data.count) {
            // the x2m data is a datapoint type list and we need the datapoint
            // type record to open the form view with an existing record
            data = data.data[0];
        }

        // WARNING: these attributes are critical when editing a x2m !
        //
        // A x2m view can use a special variable `parent` (in a field domain for
        // example) which refers to the parent datapoint data (this is added in
        // the context, see @_getEvalContext).
        // When editing x2m view, the view is opened as if it was the main view
        // and a new view means a new basic model (the reference to the parent
        // will thus lost). This is why we reuse the same model and specify a
        // `parentID` (see @_onOpenOne2ManyRecord in FormController).

        this.view_env = {
            currentId: data.res_id,
            context: data.getContext(),
            ids: data.res_ids,
            model: this.editor.model,  // reuse the same BasicModel instance
            modelName: this.x2mModel,
            parentID: this.editor.state.id,
        };
        this.renamingAllowedFields = [];
        this.x2mEditorPath.push({
            view_type: this.view_type,
            x2mField: this.x2mField,
            x2mViewType: this.x2mViewType,
            x2mModel: this.x2mModel,
            x2mData: data,
        });
        var field = fieldsInfo[this.view_type][this.x2mField];
        var def;
        // If there is no name for the subview then it's an inline view. So if there is a name,
        // we create the inline view to avoid modifying the external subview. This is a hack
        // because there is no better way to find out if the subview is inline or not.
        if (!(viewType in field.views) || field.views[viewType].name) {
            def = this._createInlineView(viewType, field.name);
        } else {
            def = this._instantiateX2mEditor();
        }
        return def.then(function () {
            if (!fromBreadcrumb) {
                bus.trigger('edition_x2m_entered', viewType, self.x2mEditorPath.slice());
            }
            self.updateSidebar('new');
        });
    },
    /**
     * Processes the fields to write the field name inside the description. This
     * name is mainly used in the sidebar.
     *
     * @private
     * @param {Object} fields
     * @returns {Object} a deep copy of fields with the key as attribute `name`
     */
    _processFields: function (fields) {
        fields = $.extend(true, {}, fields);  // deep copy
        _.each(fields, function (value, key) {
            value.name = key;
        });
        return fields;
    },
    /**
     * @private
     * @param {String} type
     * @param {Object} node
     * @param {Object} xpath_info
     */
    _removeElement: function (type, node, xpath_info) {
        // After the element removal, if the parent doesn't contain any children
        // anymore, the parent node is also deleted (except if the parent is
        // the only remaining node and if we are editing a x2many subview)
        if (!this.x2mField) {
            var parent_node = findParent(this.view.arch, node, this.expr_attrs);
            var is_root = !findParent(this.view.arch, parent_node, this.expr_attrs);
            var is_group = parent_node.tag === 'group';
            if (parent_node.children.length === 1 && !is_root && !is_group) {
                node = parent_node;
                // Since we changed the node being deleted, we recompute the xpath_info
                // if necessary
                if (node && _.isEmpty(_.pick(node.attrs, this.expr_attrs[node.tag]))) {
                    xpath_info = findParentsPositions(this.view.arch, node);
                }
            }
        }

        this.editor.unselectedElements();
        this._resetSidebarMode();
        this.do({
            type: type,
            target: {
                tag: node.tag,
                attrs: _.pick(node.attrs, this.expr_attrs[node.tag]),
                xpath_info: xpath_info,
            },
        });
    },
    /**
     * Rename field.
     *
     * @private
     * @param {string} oldName
     * @param {string} newName
     * @returns {Deferred}
     */
    _renameField: function (oldName, newName) {
        var self = this;
        return this._operationsMutex.exec(function () {
            // blockUI is used to prevent the user from doing any operation
            // because the hooks are still related to the old field name
            framework.blockUI();
            self.sidebar.$('input').attr('disabled', true);
            self.sidebar.$('select').attr('disabled', true);

            return self._rpc({
                route: '/web_studio/rename_field',
                params: {
                    studio_view_id: self.studio_view_id,
                    studio_view_arch: self.studio_view_arch,
                    model: self.x2mModel ? self.x2mModel : self.model_name,
                    old_name: oldName,
                    new_name: newName,
                },
            }).then(function () {
                self._updateOperations(oldName, newName);
                var oldFieldIndex = self.renamingAllowedFields.indexOf(oldName);
                self.renamingAllowedFields.splice(oldFieldIndex, 1);
                self.renamingAllowedFields.push(newName);
            }).always(function () {
                framework.unblockUI();
                return self.applyChanges();
            });
        });
    },
    /**
     * @private
     */
    _resetSidebarMode: function () {
        this.updateSidebar(this._getDefaultSidebarMode());
    },
    /**
     * @private
     * @param {String} model_name
     * @param {String} field_name
     * @param {*} value
     * @returns {Deferred}
     */
    _setDefaultValue: function (model_name, field_name, value) {
        var def = $.Deferred();
        var params = {
            model_name: model_name,
            field_name: field_name,
            value: value,
        };
        this._rpc({route: '/web_studio/set_default_value', params: params});
        return def;
    },
    /**
     * @private
     * @param {String} model_name
     * @param {[type]} value
     * @returns {Deferred}
     */
    _setEmailAlias: function (model_name, value) {
        return this._rpc({
            route: '/web_studio/set_email_alias',
            params: {
                model_name: model_name,
                value: value,
            },
        });
    },
    /**
     * Modifies in place the operation to add `subview_xpath` on the target key.
     *
     * @private
     * @param {Object} op
     */
    _setSubViewXPath: function (op) {
        var subviewXpath = this._getSubviewXpath(this.x2mEditorPath);
        // If the xpath_info last element is the same than the subview type
        // we remove it since it will be added by the subviewXpath.
        if (op.target.xpath_info && op.target.xpath_info[0].tag === this.x2mViewType) {
            op.target.xpath_info.shift();
        }
        op.target.subview_xpath = subviewXpath;
    },
    /**
     * Changes the widget variables to match the x2m field data.
     * The rpc is done in order to get the relational fields info of the x2m
     * being edited.
     *
     * @private
     */
    _setX2mParameters: function () {
        var self = this;
        this.view_type = this.x2mViewType;
        return this._rpc({
            model: this.x2mModel,
            method: 'fields_get',
        }).then(function (fields) {
            self.fields = self._processFields(fields);
        });
    },
    /**
     * Slugifies a string (used to transform a label into a field name)
     * Source: https://gist.github.com/mathewbyrne/1280286
     *
     * @private
     * @param {string} text
     * @returns {string}
     */
    _slugify: function (text) {
        return text.toString().toLowerCase().trim()
            .replace(/[^\w\s-]/g, '') // remove non-word [a-z0-9_], non-whitespace, non-hyphen characters
            .replace(/[\s_-]+/g, '_') // swap any length of whitespace, underscore, hyphen characters with a single _
            .replace(/^-+|-+$/g, ''); // remove leading, trailing -
    },
    /**
     * Updates the list of operations after a field renaming (i.e. replace all
     * occurences of @oldName by @newName).
     *
     * @private
     * @param {string} oldName
     * @param {string} newName
     */
    _updateOperations: function (oldName, newName) {
        var strOperations = JSON.stringify(this.operations);
        // We only want to replace exact matches of the field name, but it can
        // be preceeded/followed by other characters, like parent.my_field or in
        // a domain like [('...', '...', my_field)] etc.
        // Note that negative lookbehind is not correctly handled in JS ...
        var chars = '[^\\w\\u007F-\\uFFFF]';
        var re = new RegExp('(' + chars + '|^)' + oldName + '(' + chars + '|$)', 'g');
        this.operations = JSON.parse(strOperations.replace(re, '$1' + newName + '$2'));
    },

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * @private
     * @param {OdooEvent} event
     */
    _onCloseXMLEditor: function () {
        this.mode = 'edition';
        this.updateEditor();
        this.XMLEditor.destroy();
        this.sidebar.prependTo(this.$el);
        $('body').removeClass('o_in_studio_xml_editor');
    },
    /**
     * Show nearrest hook.
     *
     * @private
     * @param {OdooEvent} event
     */
    _onComponentDragged: function (event) {
        var is_nearest_hook = this.editor.highlightNearestHook(event.data.$helper, event.data.position);
        event.data.$helper.toggleClass('ui-draggable-helper-ready', is_nearest_hook);
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onDefaultValueChange: function (event) {
        var data = event.data;
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        this._setDefaultValue(modelName, data.field_name, data.value)
            .fail(function () {
                if (data.on_fail) {
                    data.on_fail();
                }
            });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onEmailAliasChange: function (event) {
        var value = event.data.value;
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        this._setEmailAlias(modelName, value);
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onFieldEdition: function (event) {
        var self = this;
        var node = event.data.node;
        var field = this.fields[node.attrs.name];
        var dialog = new NewFieldDialog(this, this.model_name, field, this.fields).open();
        dialog.on('field_default_values_saved', this, function (values) {
            self._rpc({
                route: '/web_studio/edit_field',
                params: {
                    model_name: self.model_name,
                    field_name: field.name,
                    values: values,
                }
            }).then(function () {
                dialog.close();
                self.applyChanges(false, false);
            });
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onFieldRenamed: function (event) {
        this._renameField(event.data.oldName, event.data.newName);
    },
    /**
     * Toggle editor sidebar.
     *
     * @private
     * @param {OdooEvent} event
     */
    _onNodeClicked: function (event) {
        var self = this;
        var node = event.data.node;
        var $node = event.data.$node;
        if (this.view_type === 'form' && node.tag === 'field') {
            var field = this.fields[node.attrs.name];
            var attrs = this.editor.state.fieldsInfo[this.editor.state.viewType][node.attrs.name];
            var isX2Many = _.contains(['one2many','many2many'], field.type);
            var notEditableWidgets = ['many2many_tags', 'hr_org_chart'];
            if (isX2Many && !_.contains(notEditableWidgets, attrs.widget)) {
                // If the node is a x2many we offer the possibility to edit or
                // create the subviews
                var message = $(QWeb.render('web_studio.X2ManyEdit'));
                var options = {
                    message: message,
                    css: {
                        cursor: 'auto',
                    },
                    overlayCSS: {
                        cursor: 'auto',
                    }
                };
                // Only the o_field_x2many div needs to be overlaid.
                // So if the node is not the div we find it before applying the overlay.
                if ($node.hasClass('o_field_one2many') || $node.hasClass('o_field_many2many')) {
                    $node.block(options);
                } else {
                    $node.find('div.o_field_one2many, div.o_field_many2many').block(options);
                }
                $node.find('.o_web_studio_editX2Many').click(function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._openX2mEditor(
                        node.attrs.name,
                        $(e.currentTarget).data('type')
                    );
                });
            }
        }
        this.updateSidebar('properties', node);
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onOpenDefaults: function () {
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        this.do_action({
            name: _t('Default Values'),
            type: 'ir.actions.act_window',
            res_model: 'ir.default',
            target: 'current',
            views: [[false, 'list'], [false, 'form']],
            domain: [['field_id.model', '=', modelName]],
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onOpenFieldForm: function (event) {
        var self = this;
        var field_name = event.data.field_name;
        var modelName = this.x2mModel ? this.x2mModel : this.model_name;
        this._rpc({
            model: 'ir.model.fields',
            method: 'search_read',
            fields: ['id'],
            domain: [['model', '=', modelName], ['name', '=', field_name]],
        }).then(function (result) {
            var res_id = result.length && result[0].id;
            if (res_id) {
                self.do_action({
                    type: 'ir.actions.act_window',
                    res_model: 'ir.model.fields',
                    res_id: res_id,
                    views: [[false, 'form']],
                    target: 'current',
                });
            }
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onOpenViewForm: function () {
        this.do_action({
            type: 'ir.actions.act_window',
            res_model: 'ir.ui.view',
            res_id: this.view_id,
            views: [[false, 'form']],
            target: 'current',
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onOpenXMLEditor: function () {
        var self = this;

        this.renamingAllowedFields = [];

        this.XMLEditor = new XMLEditor(this, this.view_id, {
            position: 'left',
            doNotLoadLess: true,

        });
        this.mode = 'rendering';

        $.when(this.updateEditor(), this.XMLEditor.prependTo(this.$el)).then(function () {
            self.sidebar.$el.detach();
            $('body').addClass('o_in_studio_xml_editor');
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onSaveXMLEditor: function (event) {
        this.do({
            type: 'replace_arch',
            view_id: event.data.view_id,
            old_arch: event.data.old_arch,
            new_arch: event.data.new_arch,
        }).then(function () {
            if (event.data.on_success) {
                event.data.on_success();
            }
        });
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onShowInvisibleToggled: function (event) {
        this.updateEditor({show_invisible: event.data.show_invisible});
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onSidebarTabChanged: function (event) {

        this.updateSidebar(event.data.mode);
        this.editor.unselectedElements();
    },
    /**
     * @private
     */
    _onUnselectElement: function () {
        this.editor.unselectedElements();
    },
    /**
     * @private
     * @param {OdooEvent} event
     */
    _onViewChange: function (event) {
        var structure = event.data.structure;
        var type = event.data.type;
        var node = event.data.node;
        var new_attrs = event.data.new_attrs || {};
        var position = event.data.position || 'after';
        var xpath_info;
        if (node && _.isEmpty(_.pick(node.attrs, this.expr_attrs[node.tag]))) {
            xpath_info = findParentsPositions(this.view.arch, node);
        }
        switch (structure) {
            case 'text':
                break;
            case 'picture':
                break;
            case 'group':
                this._addElement(type, node, xpath_info, position, 'group');
                break;
            case 'button':
                this._addButton(event.data);
                break;
            case 'notebook':
                this._addElement(type, node, xpath_info, position, 'notebook');
                break;
            case 'page':
                this._addPage(type, node, xpath_info, position);
                break;
            case 'field':
                var field_description = event.data.field_description;
                new_attrs = _.pick(new_attrs, ['name', 'widget']);
                this._addField(type, field_description, node, xpath_info, position,
                    new_attrs);
                break;
            case 'chatter':
                this._addChatter(event.data);
                break;
            case 'kanban_dropdown':
                this._addKanbanDropdown();
                break;
            case 'kanban_priority':
                this._addKanbanPriority(event.data);
                break;
            case 'kanban_image':
                this._addKanbanImage(event.data);
                break;
            case 'remove':
                this._removeElement(type, node, xpath_info);
                break;
            case 'view_attribute':
                this._editViewAttributes(type, new_attrs);
                break;
            case 'edit_attributes':
                this._editElementAttributes(type, node, xpath_info,
                    new_attrs);
                break;
            case 'filter':
                new_attrs = _.pick(new_attrs, ['name', 'string', 'domain', 'context', 'create_group']);
                this._addFilter(type, node, xpath_info, position, new_attrs);
                break;
            case 'separator':
                this._addSeparator(type, node, xpath_info, position);
                break;
            case 'enable_stage':
                this._enableStages();
                break;
        }
    },
});

function findParent(arch, node, expr_attrs) {
    var parent = arch;
    var result;
    var xpathInfo = findParentsPositions(arch, node);
    _.each(parent.children, function (child) {
        var deepEqual = true;
        // If there is not the expr_attr, we can't compare the nodes with it
        // so we compute the child xpath_info and compare it to the node
        // we are looking in the arch.
        if (_.isEmpty(_.pick(child.attrs, expr_attrs[child.tag]))) {
            var childXpathInfo = findParentsPositions(arch, child);
            _.each(xpathInfo, function (node, index) {
                if (index >= childXpathInfo.length) {
                    deepEqual = false;
                } else if (!_.isEqual(xpathInfo[index], childXpathInfo[index])) {
                    deepEqual = false;
                }
            });
        }
        if (deepEqual && child.attrs && child.attrs.name === node.attrs.name) {
            result = parent;
        } else {
            var res = findParent(child, node, expr_attrs);
            if (res) {
                result = res;
            }
        }
    });
    return result;
}

function findParentsPositions(arch, node) {
    return _findParentsPositions(arch, node, [], 1);
}

function _findParentsPositions(parent, node, positions, indice) {
    var result;
    positions.push({
        'tag': parent.tag,
        'indice': indice,
    });
    if (parent === node) {
        return positions;
    } else {
        var current_indices = {};
        _.each(parent.children, function (child) {
            // Save indice of each sibling node
            current_indices[child.tag] = current_indices[child.tag] ? current_indices[child.tag] + 1 : 1;
            var res = _findParentsPositions(child, node, positions, current_indices[child.tag]);
            if (res) {
                result = res;
            } else {
                positions.pop();
            }
        });
    }
    return result;
}

return ViewEditorManager;

});
