# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import fields, models, api, _

class AccountInvoice(models.Model):
    _inherit = 'account.invoice'

    def _default_mod_349_invoice_type(self):
        invoice_type = self.env.context.get('type', False)

        if invoice_type == 'in_invoice':
            return 'A'
        if invoice_type == 'out_invoice':
            return 'E'

    def _mod_349_selection_values(self):
        context = self.env.context
        if context.get('type') in ('out_invoice', 'out_refund'):
            return[('E', _("E - Supply")), ('T', _("T - Triangular Operation")), ('S', _("S - Services sale")), ('M', _("M - Supply without taxes")), ('H', _("H - Supply without taxes delivered by a legal representative"))]
        if context.get('type') in ('in_invoice', 'in_refund'):
            return [('A', _("A - Acquisition")), ('T', _("T - Triangular Operation")), ('I', _("I - Services acquisition"))]
        # If no type is given in context, we give access to every possible value for the field
        return [('A', _("A - Acquisition")), ('E', _("E - Supply")), ('T', _("T - Triangular Operation")), ('S', _("S - Services sale")), ('I', _("I - Services acquisition")), ('M', _("M - Supply without taxes")), ('H', _("H - Supply without taxes delivered by a legal representative"))]

    l10n_es_reports_mod347_invoice_type = fields.Selection(string="Type for mod 347", selection=[('regular', "Regular operation"), ('insurance', "Insurance operation")], default='regular', required=True, help="Defines the category into which this invoice falls for mod 347 report.")
    l10n_es_reports_mod349_invoice_type = fields.Selection(string="Type for mod 349", selection="_mod_349_selection_values", required=True, help="Defines the category into which this invoice falls for mod 349 report", default=_default_mod_349_invoice_type)
    l10n_es_reports_mod349_available = fields.Boolean(string="Available for Mod349", store=True, compute="_compute_l10n_es_reports_mod349_available", help="True if and only if the invoice must be reported on mod 349 report, i.e. it concerns an intracommunitary operation.")

    @api.depends('partner_id.country_id')
    def _compute_l10n_es_reports_mod349_available(self):
        europe_country_group = self.env.ref('base.europe')
        for record in self:
            record.l10n_es_reports_mod349_available = record.partner_id.country_id in europe_country_group.country_ids

    def _get_refund_copy_fields(self):
        rslt = super(AccountInvoice, self)._get_refund_copy_fields()
        return rslt + ['l10n_es_reports_mod347_invoice_type', 'l10n_es_reports_mod349_invoice_type']