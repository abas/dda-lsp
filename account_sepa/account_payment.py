# -*- coding: utf-8 -*-

import re

from openerp import models, fields, api, _
from openerp.exceptions import ValidationError
from sepa_credit_transfer import check_valid_SEPA_str


class AccountRegisterPayments(models.TransientModel):
    _inherit = "account.register.payments"

    partner_bank_account_id = fields.Many2one('res.partner.bank', string="Recipient Bank Account")

    @api.onchange('partner_id')
    def _onchange_partner_id(self):
        if hasattr(super(AccountRegisterPayments, self), '_onchange_partner_id'):
            super(AccountRegisterPayments, self)._onchange_partner_id()
        if self.partner_id and len(self.partner_id.bank_ids) > 0:
            self.partner_bank_account_id = self.partner_id.bank_ids[0]
        else:
            self.partner_bank_account_id = False

    def get_payment_vals(self):
        res = super(AccountRegisterPayments, self).get_payment_vals()
        if self.payment_method_id == self.env.ref('account_sepa.account_payment_method_sepa_ct'):
            res.update({'partner_bank_account_id': self.partner_bank_account_id.id})
        return res

class AccountPayment(models.Model):
    _inherit = "account.payment"

    partner_bank_account_id = fields.Many2one('res.partner.bank', string="Recipient Bank Account")

    @api.one
    @api.constrains('payment_method_id', 'communication')
    def _check_communication_sepa(self):
        if self.payment_method_id == self.env.ref('account_sepa.account_payment_method_sepa_ct'):
            if not self.communication:
                return
            if len(self.communication) > 140:
                raise ValidationError(_("A SEPA communication cannot exceed 140 characters"))
            check_valid_SEPA_str(self.communication)

    @api.one
    @api.constrains('payment_method_id', 'journal_id')
    def _check_bank_account(self):
        if self.payment_method_id == self.env.ref('account_sepa.account_payment_method_sepa_ct'):
            if not self.journal_id.bank_account_id or not self.journal_id.bank_account_id.acc_type == 'iban':
                raise ValidationError(_("The journal '%s' requires a proper IBAN account to pay via SEPA. Please configure it first.") % self.journal_id.name)
            if not self.journal_id.bank_account_id.bank_bic:
                raise ValidationError(_("The account '%s' (journal %s) requires a Bank Identification Code (BIC) to pay via SEPA. Please configure it first.")
                    % (self.journal_id.bank_account_id.acc_number, self.journal_id.name))

    @api.one
    @api.constrains('payment_method_id', 'partner_bank_account_id')
    def _check_partner_bank_account(self):
        if self.payment_method_id == self.env.ref('account_sepa.account_payment_method_sepa_ct'):
            # Note, the condition allows to use non-IBAN account. SEPA actually supports this under certain conditions
            if self.partner_bank_account_id.acc_type == 'iban' and not self.partner_bank_account_id.bank_bic:
                raise ValidationError(_("The partner account '%s' requires a Bank Identification Code (BIC) to pay via SEPA. Please configure it first.") % self.partner_bank_account_id.acc_number)

    @api.onchange('partner_id')
    def _onchange_partner_id(self):
        if hasattr(super(AccountPayment, self), '_onchange_partner_id'):
            super(AccountPayment, self)._onchange_partner_id()
        if self.partner_id and len(self.partner_id.bank_ids) > 0:
            self.partner_bank_account_id = self.partner_id.bank_ids[0]
        else:
            self.partner_bank_account_id = False

    @api.onchange('destination_journal_id')
    def _onchange_destination_journal_id(self):
        if hasattr(super(AccountPayment, self), '_onchange_destination_journal_id'):
            super(AccountPayment, self)._onchange_destination_journal_id()
        if self.destination_journal_id:
            bank_account = self.destination_journal_id.bank_account_id
            self.partner_id = bank_account.company_id.partner_id
            self.partner_bank_account_id = bank_account
