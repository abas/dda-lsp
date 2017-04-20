odoo.define('crm.voip', function(require) {
"use strict";

var voip_core = require('voip.core');
var ajax = require('web.ajax');
var basic_fields = require('web.basic_fields');
var config = require('web.config');
var core = require('web.core');
var fieldUtils = require('web.field_utils');
var real_session = require('web.session');
var SystrayMenu = require('web.SystrayMenu');
var web_client = require('web.web_client');
var WebClient = require('web.WebClient');
var Widget = require('web.Widget');
var dialing_panel = null;

var _t = core._t;
var QWeb = core.qweb;
var HEIGHT_OPEN = '450px';
var HEIGHT_FOLDED = '0px';

// As voip is not supported on mobile devices, we want to keep the standard phone widget
if (config.device.size_class <= config.device.SIZES.XS) {
    return;
}

var PhonecallWidget = Widget.extend({
    "template": "crm_voip.PhonecallWidget",
    events: {
        "click": "select_call",
        "click .o_dial_remove_phonecall": "remove_phonecall"
    },
    init: function(parent, phonecall) {
        this._super(parent);
        this.id = phonecall.id;
        if(phonecall.partner_name){
            this.partner_name = _.str.truncate(phonecall.partner_name,19);
        }else{
            this.partner_name = _t("Unknown");
        }
        this.state =phonecall.state;
        this.image_small = phonecall.partner_image_small;
        this.email =phonecall.partner_email;
        this.name =_.str.truncate(phonecall.name,23);
        this.opportunity_id = phonecall.opportunity_id;
        this.partner_id = phonecall.partner_id;
        this.opportunity_name = phonecall.opportunity_name;
        this.opportunity_planned_revenue = fieldUtils.format.monetary(
            phonecall.opportunity_planned_revenue,
            null,
            {currency_id: phonecall.opportunity_company_currency}
        );
        this.partner_phone = phonecall.partner_phone;
        this.description = phonecall.description;
        this.opportunity_probability = phonecall.opportunity_probability;
        this.date= phonecall.date;
        this.duration = phonecall.duration;
        this.opportunity_date_action = phonecall.opportunity_date_action;
        this.display_opp_name = true;
        this.opportunity_title_action = phonecall.opportunity_title_action;
        if(!this.opportunity_name){
            this.opportunity_name = _t("No opportunity linked");
        }else if(this.opportunity_name === phonecall.name){
            this.display_opp_name = false;
        }
        this.max_priority = phonecall.max_priority;
        this.opportunity_priority = phonecall.opportunity_priority;
    },

    start: function(){
        var empty_star = parseInt(this.max_priority) - parseInt(this.opportunity_priority);
        //creation of the tooltip
        this.$el.popover({
            placement : 'right', // top, bottom, left or right
            title : QWeb.render("crm_voip_Tooltip_title", {
                name: this.name, priority: parseInt(this.opportunity_priority), empty_star:empty_star}), 
            html: 'true', 
            content :  QWeb.render("crm_voip_Tooltip",{
                display_opp_name: this.display_opp_name,
                opportunity: this.opportunity_name,
                partner_name: this.partner_name,
                phone: this.partner_phone,
                description: this.description,
                email: this.partner_email,
                title_action: this.opportunity_title_action,
                planned_revenue: this.opportunity_planned_revenue,
                probability: this.opportunity_probability,
                date: this.date,
            }),
        });
    },

    //select the clicked call, show options and put some highlight on it
    select_call: function(){
        this.trigger("select_call", this.id);
    },

    remove_phonecall: function(e){
        e.stopPropagation();
        e.preventDefault();
        this.trigger("remove_phonecall",this);
    },

    set_state: function(state){
        if(state !== this.state){
            this.state = state;
            if(state === 'in_call'){
                this.$('.o_dial_phonecall_partner_name')
                    .after("<i style='margin-left:5px;' class='fa fa-microphone o_dial_icon_inCall'></i>");
            }else if(state === 'pending' && !this.$('.o_dial_state_icon_pending').length){
                this.$('.o_dial_status_span')
                    .append('<i class="fa fa-stack o_dial_state_icon" style="width:13px; height:15px;line-height: 13px;">'+
                            '<i class="fa fa-phone fa-stack-1x o_dial_state_icon text-muted"' + 'style="color: LightCoral;"></i>'+
                            '<i class="fa fa-times fa-stack-1x o_dial_state_icon"'+
                            'style="color: LightCoral;font-size: 8px;left: 4px;position: relative;bottom: 6px;"></i>'+
                            '</i>');
                this.$('.o_dial_icon_inCall').remove();
                if(this.$('.o_dial_state_icon_done').length){
                    this.$('.o_dial_state_icon_done').remove();
                }
            }else{
                this.$('.o_dial_icon_inCall').remove();
            }
        }
    },

    schedule_call: function(){
        return this._rpc({
                model: 'crm.phonecall',
                method: 'schedule_another_phonecall',
                args: [this.id],
            })
            .then(function(action){
                web_client.action_manager.do_action(action);
            });
    },

    send_email: function(){
        if(this.opportunity_id){
            web_client.action_manager.do_action({
                type: 'ir.actions.act_window',
                res_model: 'mail.compose.message',
                src_model: 'crm.phonecall',
                multi: "True",
                target: 'new',
                key2: 'client_action_multi',
                context: {
                            'default_composition_mode': 'mass_mail',
                            'active_ids': [this.opportunity_id],
                            'default_model': 'crm.lead',
                            'default_partner_ids': [this.partner_id],
                            'default_use_template': true,
                        },
                views: [[false, 'form']],
            });
        }else if(this.partner_id){
            web_client.action_manager.do_action({
                type: 'ir.actions.act_window',
                res_model: 'mail.compose.message',
                src_model: 'crm.phonecall',
                multi: "True",
                target: 'new',
                key2: 'client_action_multi',
                context: {
                            'default_composition_mode': 'mass_mail',
                            'active_ids': [this.partner_id],
                            'default_model': 'res.partner',
                            'default_partner_ids': [this.partner_id],
                            'default_use_template': true,
                        },
                views: [[false, 'form']],
            });
        }
    },

    to_lead: function(){
        var self = this;
        if(this.opportunity_id){
            //Call of the function xmlid_to_res_model_res_id to get the id of the opportunity's form view and not the lead's form view
            return this._rpc({
                    model: 'ir.model.data',
                    method: 'xmlid_to_res_model_res_id',
                    args: ["crm.crm_case_form_view_oppor"],
                })
                .then(function(data){
                    web_client.action_manager.do_action({
                        type: 'ir.actions.act_window',
                        res_model: "crm.lead",
                        res_id: self.opportunity_id,
                        views: [[data[1], 'form']],
                        target: 'current',
                        context: {},
                        flags: {initial_mode: "edit",},
                    });
                });
        }else{
            return this._rpc({
                    model: 'crm.phonecall',
                    method: 'action_button_to_opportunity',
                    args: [[this.id]],
                })
                .then(function(result){
                    result.flags= {initial_mode: "edit",};
                    web_client.action_manager.do_action(result);
                });
        }
    },

    to_client: function(){
        web_client.action_manager.do_action({
            type: 'ir.actions.act_window',
            res_model: "res.partner",
            res_id: this.partner_id,
            views: [[false, 'form']],
            target: 'current',
            context: {},
            flags: {initial_mode: "edit",},
        });
    },

});

var DialingPanel = Widget.extend({
    template: "crm_voip.DialingPanel",
    events:{
        "keyup .o_dial_searchbox": "input_change",
        "click .o_dial_fold": "toggle_fold",
        "click .o_dial_close_icon": function(ev){ev.preventDefault();this.toggle_display();},
        "click .o_dial_call_button":  "call_button",
        "click .o_dial_refresh_icon": function(ev){ev.preventDefault();this.search_phonecalls_status(true);},
        "click .o_dial_keypad_icon": function(ev){ev.preventDefault();this.toggle_keypad();},
        "click .O_dial_number": function(ev){ev.preventDefault();this.keypad_button(ev.currentTarget.textContent);},
        "click .o_dial_keypad_backspace": "keypad_backspace",
        "click .o_dial_keypad_call_button": "keypad_call_button",
        "click .o_dial_hangup_button": "hangup_button",
        "click .o_dial_schedule_call": "schedule_call",
        "click .o_dial_email": "send_email",
        "click .o_dial_to_client": "to_client",
        "click .o_dial_to_lead": "to_lead",
        "click .o_dial_transfer_button": "transfer_button",
        "click .o_dial_autocall_button": function(ev){ev.preventDefault();this.auto_call_button();},
        "click .o_dial_stop_autocall_button": "stop_automatic_call",
    },
    init: function(parent) {
        if(dialing_panel){
            return dialing_panel;
        }   
        this._super(parent);
        //phonecalls in the queue 
        this.widgets = {};
        this.in_call = false;
        this.in_automatic_mode = false;
        this.current_phonecall = null;
        this.shown = false;
        this.folded = false;
        this.optional_buttons_animated = false;
        this.optional_buttons_shown = false;
        //phonecalls which will be called in automatic mode.
        //To avoid calling already done calls
        this.phonecalls_auto_call = [];
        this.selected_phonecall = null;
        //create the sip user agent and bind actions
        this.sip_js = new voip_core.UserAgent();
        this.sip_js.on('sip_ringing',this,this.sip_ringing);
        this.sip_js.on('sip_accepted',this,this.sip_accepted);
        this.sip_js.on('sip_cancel',this,this.sip_cancel);
        this.sip_js.on('sip_rejected',this,this.sip_rejected);
        this.sip_js.on('sip_bye',this,this.sip_bye);
        this.sip_js.on('sip_error',this,this.sip_error);
        this.sip_js.on('sip_error_resolved',this,this.sip_error_resolved);
        this.sip_js.on('sip_customer_unavailable',this,this.sip_customer_unavailable);
        this.sip_js.on('sip_incoming_call',this,this.sip_incoming_call);
        this.sip_js.on('sip_end_incoming_call',this,this.sip_end_incoming_call);

        //bind the bus trigger with the functions
        core.bus.on('reload_panel', this, this.search_phonecalls_status);
        core.bus.on('transfer_call',this,this.transfer_call);
        core.bus.on('select_call',this,this.select_call);
        core.bus.on('next_call',this,this.next_call);
        core.bus.on('voip_toggle_display',this,this.toggle_display);

        dialing_panel = this;
        this.appendTo(web_client.$el);
    },

    start: function(){
        this.$el.css("bottom", 0);
        this.$big_call_button = this.$('.o_dial_big_call_button');
        this.$hangup_button = this.$('.o_dial_hangup_button');
        this.$hangup_transfer_buttons = this.$(".o_dial_transfer_button, .o_dial_hangup_button");
        this.$optional_buttons = this.$('.o_dial_schedule_call, .o_dial_email, .o_dial_to_client, .o_dial_to_lead');
        this.$dial_display_pannel = this.$(".o_dial_display_pannel");
        this.$dial_search_input = this.$(".o_dial_search_input");
        this.$dial_keypad = this.$(".o_dial_keypad");
        this.$dial_keypad.hide();
        this.$dial_keypad_optional = this.$(".o_dial_keypad_optional");
        this.$dial_dial_keypad_input = this.$(".o_dial_keypad_input");
        this.$el.hide();
    },

    toggle_display: function(){
        if (this.shown) {
            if(!this.folded){
                this.$el.hide()
                this.shown = ! this.shown;
            }else{
                this.toggle_fold(false);
            }
        } else {
            // update the list of user status when show the dialing panel
            this.search_phonecalls_status();
            if(!this.folded){
                this.$el.show()
                this.shown = ! this.shown;
            }else{
                this.toggle_fold(false);
            }
        }
    },

    fold: function () {
        this.$el.animate({
            height: this.folded ? HEIGHT_FOLDED : HEIGHT_OPEN
        });
        if (this.folded) {
            this.$el.find('.o_dial_fold > i').addClass('fa-angle-up');
            this.$el.find('.o_dial_fold > i').removeClass('fa-angle-down');
        } else {
            this.$el.find('.o_dial_fold > i').removeClass('fa-angle-up');
            this.$el.find('.o_dial_fold > i').addClass('fa-angle-down');
        }
    },

    toggle_fold: function (fold) {
        if (config.device.size_class !== config.device.SIZES.XS) {
            if(this.folded){
                // update the list of user status when show the dialing panel
                this.search_phonecalls_status();
            }
            this.folded = _.isBoolean(fold) ? fold : !this.folded;
            this.fold();
        } else {
            this.toggle_display();
        }
    },

    toggle_keypad: function(){
        this.toggle_keypad_optional();
        if (this.$dial_display_pannel.is(":visible")){
            this.$dial_display_pannel.hide();
            this.$dial_search_input.hide();
            this.$dial_keypad.show();
        }else{
            this.$dial_display_pannel.show();
            this.$dial_search_input.show();
            this.$dial_keypad.hide();
        }
    },

    toggle_keypad_optional: function(){
        if(this.in_call){
            this.$dial_keypad_optional.hide();
        }else{
            this.$dial_keypad_optional.show();
        }
    },

    keypad_button: function(number){
        if(this.in_call){
            this.sip_js.send_dtmf(number);
        }else{
            var val = this.$dial_dial_keypad_input.val();
            this.$dial_dial_keypad_input.val(val + number);
        }
    },

    keypad_backspace: function(){
        if(!this.in_call){
            var val = this.$dial_dial_keypad_input.val();
            this.$dial_dial_keypad_input.val(val.slice(0, -1));
        }
    },

    keypad_call_button: function(){
        if(!this.in_call){
            var self = this;
            var number = this.$dial_dial_keypad_input.val();
            return this._rpc({
                    model: 'crm.phonecall',
                    method: 'get_new_phonecall',
                    args: [number],
                })
                .then(function(result){
                    var phonecall = result.phonecall[0];
                    self.toggle_keypad();
                    self.display_in_queue(phonecall);
                    self.select_call(phonecall.id);
                    self.make_call(phonecall.id);
                    self.$dial_dial_keypad_input.val("");
                });
        }
    },

    //Modify the phonecalls list when the search input changes
    input_change: function(event) {
        var search = $(event.target).val().toLowerCase();
        //for each phonecall, check if the search is in phonecall name or the partner name
        _.each(this.widgets,function(phonecall){
            var flag = phonecall.partner_name.toLowerCase().indexOf(search) === -1 && 
                phonecall.name.toLowerCase().indexOf(search) === -1;
            phonecall.$el.toggle(!flag);
        });
    },

    sip_ringing: function(){
        this.$big_call_button.html('<i class="fa fa-phone"></i>' + '<i class="fa fa-rss"></i>');
        this.$hangup_button.removeAttr('disabled');
        this.widgets[this.current_phonecall].set_state('in_call');
    },


    sip_accepted: function(){
        this._rpc({
                model: 'crm.phonecall',
                method: 'init_call',
                args: [this.current_phonecall],
            });
        this.$('.o_dial_transfer_button').removeAttr('disabled');
    },

    sip_incoming_call: function(){
        this.in_call = true;
        this.$big_call_button.html('<i class="fa fa-phone"></i>' + '<i class="fa fa-rss"></i>');
        this.$hangup_transfer_buttons.removeAttr('disabled');
    },

    sip_end_incoming_call: function(){
        this.in_call = false;
        this.$big_call_button.html('<i class="fa fa-phone"></i>');
        this.$hangup_transfer_buttons.attr('disabled','disabled');
    },

    sip_cancel: function(){
        this.in_call = false;
        this.widgets[this.current_phonecall].set_state('pending');
        this._rpc({
                model: 'crm.phonecall',
                method: 'rejected_call',
                args: [this.current_phonecall],
            });
        if(this.in_automatic_mode){
            this.next_call();
        }else{
            this.$big_call_button.html('<i class="fa fa-phone"></i>');
            this.$hangup_transfer_buttons.attr('disabled','disabled');
            this.$(".popover").remove();
        }
    },

    sip_customer_unavailable: function(){
        this.do_notify(_t('Customer unavailable'),_t('The customer is temporary unavailable. Please try later.'));
    },

    sip_rejected: function(){
        this.in_call = false;
        this._rpc({
                model: 'crm.phonecall',
                method: 'rejected_call',
                args: [this.current_phonecall],
            });
        this.widgets[this.current_phonecall].set_state('pending');
        if(this.in_automatic_mode){
            this.next_call();
        }else{
            this.$big_call_button.html('<i class="fa fa-phone"></i>');
            this.$hangup_transfer_buttons.attr('disabled','disabled');
            this.$(".popover").remove();
        }
    },

    sip_bye: function(){
        this.in_call = false;
        this.$big_call_button.html('<i class="fa fa-phone"></i>');
        this.$hangup_transfer_buttons.attr('disabled','disabled');
        this.$(".popover").remove();
        this._rpc({
                model: 'crm.phonecall',
                method: 'hangup_call',
                args: [this.current_phonecall],
            })
            .then(_.bind(this.hangup_call,this));
    },

    hangup_call: function(result){
        var duration = parseFloat(result.duration).toFixed(2);
        this.log_call(duration);
        this.selected_phonecall = false;
    },

    sip_error: function(message, temporary){
        var self = this;
        this.in_call = false;
        this.$big_call_button.html('<i class="fa fa-phone"></i>');
        this.$hangup_transfer_buttons.attr('disabled','disabled');
        this.$(".popover").remove();
        if(temporary){
            this.$().block({message: message});
            this.$('.blockOverlay').on("click",function(){self.sip_error_resolved();});
            this.$('.blockOverlay').attr('title',_t('Click to unblock'));
        }else{
            this.$().block({message: message + '<br/><button type="button" class="btn btn-danger btn-sm btn-configuration">Configuration</button>'});
            this.$('.btn-configuration').on("click",function(){
                //Call in order to get the id of the user's preference view instead of the user's form view
                self._rpc({
                        model: 'ir.model.data',
                        method: 'xmlid_to_res_model_res_id',
                        args:["base.view_users_form_simple_modif"],
                    })
                    .then(function(data){
                        web_client.action_manager.do_action(
                            {
                                name: "Change My Preferences",
                                type: "ir.actions.act_window",
                                res_model: "res.users",
                                res_id: real_session.uid,
                                target: "new",
                                xml_id: "base.action_res_users_my",
                                views: [[data[1], 'form']],
                            }
                        );
                    });
            });
        }
    },

    sip_error_resolved: function(){
        this.$().unblock();
    },

    log_call: function(duration){
        var value = duration;
        var pattern = '%02d:%02d';
        var min = Math.floor(value);
        var sec = Math.round((value % 1) * 60);
        if (sec === 60){
            sec = 0;
            min = min + 1;
        }
        this.widgets[this.current_phonecall].duration = _.str.sprintf(pattern, min, sec);
        web_client.action_manager.do_action({
                name: _t('Log a call'),
                type: 'ir.actions.act_window',
                key2: 'client_action_multi',
                src_model: "crm.phonecall",
                res_model: "crm.phonecall.log.wizard",
                multi: "True",
                target: 'new',
                context: {'phonecall_id': this.current_phonecall,
                'default_opportunity_id': this.widgets[this.current_phonecall].opportunity_id,
                'default_name': this.widgets[this.current_phonecall].name,
                'default_duration': this.widgets[this.current_phonecall].duration,
                'default_description' : this.widgets[this.current_phonecall].description,
                'default_opportunity_name' : this.widgets[this.current_phonecall].opportunity_name,
                'default_opportunity_planned_revenue' : this.widgets[this.current_phonecall].opportunity_planned_revenue,
                'default_opportunity_title_action' : this.widgets[this.current_phonecall].opportunity_title_action,
                'default_opportunity_date_action' : this.widgets[this.current_phonecall].opportunity_date_action,
                'default_opportunity_probability' : this.widgets[this.current_phonecall].opportunity_probability,
                'default_partner_id': this.widgets[this.current_phonecall].partner_id,
                'default_partner_name' : this.widgets[this.current_phonecall].partner_name,
                'default_partner_phone' : this.widgets[this.current_phonecall].partner_phone,
                'default_partner_email' : this.widgets[this.current_phonecall].partner_email,
                'default_partner_image_small' : this.widgets[this.current_phonecall].image_small,
                'default_in_automatic_mode': this.in_automatic_mode,},
                views: [[false, 'form']],
                flags: {
                    'headless': true,
                },
            });
    },

    make_call: function(phonecall_id){
        if(!this.in_call){
            this.current_phonecall = phonecall_id;
            var number;
            if(!this.widgets[this.current_phonecall].partner_phone){
                this.do_notify(_t('The phonecall has no number'),_t('Please check if a phone number is given for the current phonecall'));
                return;
            }
            number = this.widgets[this.current_phonecall].partner_phone;
            //Select the current call if not already selected
            if(!this.selected_phonecall || this.selected_phonecall.id !== this.current_phonecall ){
                this.select_call(this.current_phonecall);
            }
            this.in_call = true;
            this.sip_js.make_call(number);
        }
    },

    next_call: function(){
        if(this.phonecalls_auto_call.length){
            if(!this.in_call){
                this.make_call(this.phonecalls_auto_call.shift());
            }
        }else{
            this.stop_automatic_call();
        }
    },

    stop_automatic_call: function(){
        this.in_automatic_mode = false;
        this.$(".o_dial_split_call_button").show();
        this.$(".o_dial_stop_autocall_button").hide();
        if(!this.in_call){
            this.$big_call_button.html(_t("Call"));
            this.$hangup_transfer_buttons.attr('disabled','disabled');
            this.$(".popover").remove();
        }else{
            this.$big_call_button.html('<i class="fa fa-phone"></i>' + '<br/>' + _t("Calling..."));
        }
    },

    //Get the phonecalls and create the widget to put inside the panel
    search_phonecalls_status: function(refresh_by_user) {
        //get the phonecalls' information and populate the queue
        this._rpc({model: 'crm.phonecall', method: 'get_list'})
            .then(_.bind(this.parse_phonecall,this,refresh_by_user));
    },

    parse_phonecall: function(refresh_by_user,result){
        var self = this;
        _.each(self.widgets, function(w) {
            w.destroy();
        });                
        self.widgets = {};
        
        var phonecall_displayed = false;
        //for each phonecall display it only if the date is lower than the current one
        //if the refresh is done by the user, retrieve the phonecalls set as "done"
        _.each(result.phonecalls, function(phonecall){
            phonecall_displayed = true;
            if(refresh_by_user){
                if(phonecall.state !== "done"){
                    self.display_in_queue(phonecall);
                }else{
                    self._rpc({
                            model: 'crm.phonecall',
                            method: 'remove_from_queue',
                            args: [phonecall.id],
                        });
                }
            }else{
                self.display_in_queue(phonecall);
            }
        });
        if(!this.in_call){
            this.$hangup_transfer_buttons.attr('disabled','disabled');
        }

        if(!phonecall_displayed){
            this.$(".o_dial_call_button, .o_call_dropdown").attr('disabled','disabled');
        }else{
            this.$(".o_dial_call_button, .o_call_dropdown").removeAttr('disabled');
        }
        //select again the selected phonecall before the refresh
        if(this.selected_phonecall){
            this.select_call(this.selected_phonecall.id);
        }else{
            this.$optional_buttons.hide();
        }
        if(this.current_call_deferred){
            this.current_call_deferred.resolve();
        }

    },

    //function which will add the phonecall in the queue and create the tooltip
    display_in_queue: function(phonecall){
        //Check if the current phonecall is currently done to add the microphone icon

        var widget = new PhonecallWidget(this, phonecall);
        if(this.in_call && phonecall.id === this.current_phonecall){
            widget.set_state('in_call');
        }
        widget.appendTo(this.$(".o_dial_phonecalls"));
        widget.on("select_call", this, this.select_call);
        widget.on("remove_phonecall",this,this.remove_phonecall);
        this.widgets[phonecall.id] = widget;
    },

    //action to change the main view to go to the opportunity's view
    to_lead: function() {
        this.widgets[this.selected_phonecall.id].to_lead();
    },

    //action to change the main view to go to the client's view
    to_client: function() {
        this.widgets[this.selected_phonecall.id].to_client();
    },

    //action to select a call and display the specific actions
    select_call: function(phonecall_id){
        var selected_phonecall = this.widgets[phonecall_id];
        if(!selected_phonecall){
            selected_phonecall = false;
            this.$optional_buttons.hide();
            return;
        }
        if(this.optional_buttons_animated){
            return;
        }
        var selected = selected_phonecall.$el.hasClass("o_dial_selected_phonecall");
        this.$(".o_dial_selected_phonecall").removeClass("o_dial_selected_phonecall");
        if(!selected){
            //selection of the phonecall
            selected_phonecall.$el.addClass("o_dial_selected_phonecall");
            //if the optional buttons are not up, they are displayed
            this.$optional_buttons.show();
            //check if the phonecall has an email to display the send email button or not
            if(selected_phonecall.email){
                this.$(".o_dial_email").removeAttr('disabled');
            }else{
                this.$(".o_dial_email").attr('disabled','disabled');
            }
        }else{
            //unselection of the phonecall
            selected_phonecall = false;
            this.$optional_buttons.hide();
        }
        this.selected_phonecall = selected_phonecall;
    },

    //remove the phonecall from the queue
    remove_phonecall: function(phonecall_widget){
        var self = this;
        return this._rpc({
                model: 'crm.phonecall',
                method: 'remove_from_queue',
                args: [phonecall_widget.id],
            })
            .then(function(){
                self.search_phonecalls_status();
                self.$(".popover").remove();
            });
    },

    //action done when the button "call" is clicked
    call_button: function(){
        if(this.selected_phonecall){
            this.make_call(this.selected_phonecall.id);
        }else{
            var next_call = _.filter(this.widgets, function(widget){return widget.state !== "done";}).shift();
            if(next_call){
                this.make_call(next_call.id);
            }
        }
    },

    auto_call_button: function(){
        var self = this;
        if(this.in_call){
            return;
        }
        this.$(".o_dial_split_call_button").hide();
        this.$(".o_dial_stop_autocall_button").show();
        this.in_automatic_mode = true;
        this.phonecalls_auto_call = [];
         _.each(this.widgets,function(phonecall){
            if(phonecall.state !== "done"){
                self.phonecalls_auto_call.push(phonecall.id);
            }
        });
        if(this.phonecalls_auto_call.length){
            this.make_call(this.phonecalls_auto_call.shift());
        }else{
            this.stop_automatic_call();
        }
    },

    //action done when the button "Hang Up" is clicked
    hangup_button: function(){
        this.sip_js.hangup();
    },

    //action done when the button "Transfer" is clicked
    transfer_button: function(){
        //Launch the transfer wizard
        web_client.action_manager.do_action({
            type: 'ir.actions.act_window',
            key2: 'client_action_multi',
            src_model: "crm.phonecall",
            res_model: "crm.phonecall.transfer.wizard",
            multi: "True",
            target: 'new',
            context: {},
            views: [[false, 'form']],
            flags: {
                'headless': true,
            },
        });
    },

    //action done when the transfer_call action is triggered
    transfer_call: function(number){
        this.sip_js.transfer(number);
    },

    //action done when the button "Reschedule Call" is clicked
    schedule_call: function(){
        this.widgets[this.selected_phonecall.id].schedule_call();
    },

    //action done when the button "Send Email" is clicked
    send_email: function(){
        this.widgets[this.selected_phonecall.id].send_email();
    },

    call_partner: function(number, partner_id){
        var self = this;
        return this._rpc({
                model: 'res.partner',
                method: 'create_call_in_queue',
                args: [partner_id, number],
            })
            .then(function(phonecall_id){
                self.current_call_deferred = $.Deferred();
                self.search_phonecalls_status();
                self.current_call_deferred.done(function(){
                    self.make_call(phonecall_id);
                    if(!self.shown){
                        self.toggle_display();
                    }
                });
            });
    },

    call_opportunity: function(number, opportunity_id){
        var self = this;
        return this._rpc({
                model: 'crm.lead',
                method: 'create_call_form_view',
                args: [opportunity_id],
            })
            .then(function(phonecall_id){
                self.current_call_deferred = $.Deferred();
                self.search_phonecalls_status();
                self.current_call_deferred.done(function(){
                    self.make_call(phonecall_id);
                    if(!self.shown){
                        self.toggle_display();
                    }
                });
            });
    },
});
    
var VoipTopButton = Widget.extend({
    template:'crm_voip.switch_panel_top_button',
    events: {
        "click": "toggle_display",
    },

    // TODO remove and replace with session_info mechanism
    willStart: function(){
        var ready = this.getSession().user_has_group('base.group_user').then(
            function(is_employee){
                if (!is_employee) {
                    return $.Deferred().reject();
                }
            });
        return $.when(this._super.apply(this, arguments), ready);
    },

    toggle_display: function (ev){
        ev.preventDefault();
        core.bus.trigger('voip_toggle_display');
    },
});

// Put the ComposeMessageTopButton widget in the systray menu
SystrayMenu.Items.push(VoipTopButton);

//Trigger the client action "reload_panel" that will be catch by the widget to reload the panel
var reload_panel = function (parent, action) {
    var params = action.params || {};
    if(params.go_to_opp){
        //Call of the function xmlid_to_res_model_res_id to get the id of the opportunity's form view and not the lead's form view
        return ajax.rpc('/web/dataset/call_kw/ir.model.data/xmlid_to_res_model_res_id', {
                model : "ir.model.data",
                method: "xmlid_to_res_model_res_id",
                args: ["crm.crm_case_form_view_oppor"],
                kwargs: {}
            }).then(function(data){
                web_client.action_manager.do_action({
                    type: 'ir.actions.act_window',
                    res_model: "crm.lead",
                    res_id: params.opportunity_id,
                    views: [[data[1], 'form']],
                    target: 'current',
                    context: {},
                    flags: {initial_mode: "edit",},
                });
            });
    }
    core.bus.trigger('reload_panel');

    if(params.in_automatic_mode){
        core.bus.trigger('next_call');
    }
    //Return an action to close the wizard after the reload of the panel
    return { type: 'ir.actions.act_window_close' };
};

var transfer_call = function(parent, action){
    var params = action.params || {};
    core.bus.trigger('transfer_call', params.number);
    return { type: 'ir.actions.act_window_close' };
};

core.action_registry.add("reload_panel", reload_panel);
core.action_registry.add("transfer_call", transfer_call);

/**
 * Override of FieldPhone to use the DialingPanel to perform calls on clicks.
 */
var Phone = basic_fields.FieldPhone;
Phone.include({
    events: _.extend({}, Phone.prototype.events, {
        'click': '_onClick',
    }),

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Uses the DialingPanel to perform the call.
     *
     * @private
     * @param {char} phone_number
     */
    _call: function (phone_number) {
        this.do_notify(_t('Start Calling'), _t('Calling ') + ' ' + phone_number);
        if (this.model === 'res.partner') {
            this.DialingPanel.call_partner(phone_number, this.res_id);
        } else if (this.model === 'crm.lead') {
            this.DialingPanel.call_opportunity(phone_number, this.res_id);
        }
    },
    /**
     * @override
     * @private
     * @returns {boolean} true
     */
    _canCall: function () {
        return true;
    },

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * Called when the phone number is clicked.
     *
     * @private
     * @param {MouseEvent} e
     */
    _onClick: function (e) {
        var allowed_models = ['res.partner', 'crm.lead'];
        if (this.mode === 'readonly' && _.contains(allowed_models, this.model)) {
            e.preventDefault();
            var phone_number = this.value;

            if (this.recordData.phone === phone_number || this.recordData.mobile === phone_number) {
                if (this.DialingPanel) {
                    this._call(phone_number);
                } else {
                    this.DialingPanel = new DialingPanel(web_client);
                    this._call(phone_number);
                }
            }
        }
    },
});

WebClient.include({
    show_application: function(){
        var self = this;
        return this._super.apply(this, arguments).then(function () {
            self.DialingPanel = new DialingPanel(web_client);
        });
    },
});

return {
    voipTopButton: new VoipTopButton(),
};

});
