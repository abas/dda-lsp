# -*- coding: utf-8 -*-

from odoo import api, fields, models


class FcmResConfig(models.TransientModel):
    _inherit = 'base.config.settings'

    default_mail_push_notification = fields.Boolean('Notifications', default_model='base.config.settings')
    fcm_api_key = fields.Char('Server API Key')
    fcm_project_id = fields.Char('Sender ID')

    @api.multi
    def set_fcm_api_key(self):
        fcm_api_key = self[0].fcm_api_key or ''
        self.env['ir.config_parameter'].set_param('fcm_api_key', fcm_api_key)

    @api.multi
    def set_fcm_project_id(self):
        fcm_project_id = self[0].fcm_project_id or ''
        self.env['ir.config_parameter'].set_param('fcm_project_id', fcm_project_id)

    @api.multi
    def get_default_fcm_credentials(self, fields=None):
        get_param = self.env['ir.config_parameter'].sudo().get_param
        fcm_api_key = get_param('fcm_api_key', default='')
        fcm_project_id = get_param('fcm_project_id', default='')
        return {
            'fcm_api_key': fcm_api_key,
            'fcm_project_id': fcm_project_id
        }