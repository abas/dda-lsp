# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import api, fields, models


class SaleConfiguration(models.TransientModel):
    _inherit = 'sale.config.settings'

    default_print_provider = fields.Many2one('print.provider', string='Default Print Provider')

    @api.model
    def get_default_print_provider(self, fields):
        default_provider = False
        if 'default_print_provider' in fields:
            default_provider = self.env['ir.values'].get_default('print.order', 'provider_id')
        return {
            'default_print_provider': default_provider
        }

    @api.multi
    def set_default_print_provider(self):
        for wizard in self:
            self.env['ir.values'].sudo().set_default('print.order', 'provider_id', wizard.default_print_provider.id)
