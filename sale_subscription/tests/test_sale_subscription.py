# -*- coding: utf-8 -*-
import calendar
import datetime
from dateutil.relativedelta import relativedelta

from odoo.addons.sale_subscription.tests.common_sale_subscription import TestSubscriptionCommon
from odoo.tools import mute_logger, float_utils
from odoo import fields


class TestSubscription(TestSubscriptionCommon):

    @mute_logger('odoo.addons.base.ir.ir_model', 'odoo.models')
    def test_template(self):
        """ Test behaviour of on_change_template """
        Subscription = self.env['sale.subscription']

        # on_change_template on existing record (present in the db)
        self.subscription.template_id = self.subscription_tmpl
        self.subscription.on_change_template()
        self.assertFalse(self.subscription.description, 'sale_subscription: recurring_invoice_line_ids copied on existing sale.subscription record')

        # on_change_template on cached record (NOT present in the db)
        temp = Subscription.new({'name': 'CachedSubscription',
                                 'state': 'open',
                                 'partner_id': self.user_portal.partner_id.id})
        temp.update({'template_id': self.subscription_tmpl.id})
        temp.on_change_template()
        self.assertTrue(temp.description, 'sale_subscription: description not copied on new cached sale.subscription record')

    @mute_logger('odoo.addons.base.ir.ir_model', 'odoo.models')
    def test_sale_order(self):
        """ Test sales order line copying for recurring products on confirm"""
        self.sale_order.action_confirm()
        self.assertTrue(len(self.subscription.recurring_invoice_line_ids.ids) == 1, 'sale_subscription: recurring_invoice_line_ids not created when confirming sale_order with recurring_product')
        self.assertEqual(self.sale_order.subscription_management, 'upsell', 'sale_subscription: so should be set to "upsell" if not specified otherwise')

    def test_auto_close(self):
        """Ensure a 15 days old 'online payment' subscription gets closed if no token is set."""
        self.subscription_tmpl.payment_mandatory = True
        self.subscription.write({
            'recurring_next_date': fields.Date.to_string(datetime.date.today() - relativedelta(days=17)),
            'recurring_total': 42,
            'template_id': self.subscription_tmpl.id,
        })
        self.subscription.with_context(auto_commit=False)._recurring_create_invoice(automatic=True)
        self.assertEqual(self.subscription.state, 'close', 'website_contrect: subscription with online payment and no payment method set should get closed after 15 days')

    # Mocking for 'test_auto_payment_with_token'
    # Necessary to have a valid and done transaction when the cron on subscription passes through
    def _mock_subscription_do_payment(self, payment_method, invoice, two_steps_sec=True):
        tx_obj = self.env['payment.transaction']
        reference = "CONTRACT-%s-%s" % (self.id, datetime.datetime.now().strftime('%y%m%d_%H%M%S'))
        values = {
            'amount': invoice.amount_total,
            'acquirer_id': self.acquirer.id,
            'type': 'server2server',
            'currency_id': invoice.currency_id.id,
            'reference': reference,
            'payment_token_id': payment_method.id,
            'partner_id': invoice.partner_id.id,
            'partner_country_id': invoice.partner_id.country_id.id,
            'invoice_id': invoice.id,
            'state': 'done',
        }
        tx = tx_obj.create(values)
        return tx

    # Mocking for 'test_auto_payment_with_token'
    # Otherwise the whole sending mail process will be triggered
    # And we are not here to test that flow, and it is a heavy one
    def _mock_subscription_send_success_mail(self, tx, invoice):
        self.mock_send_success_count += 1
        return 666

    # Mocking for 'test_auto_payment_with_token'
    # Avoid account_id is False when creating the invoice
    def _mock_prepare_invoice_data(self):
        invoice = self.original_prepare_invoice_data()
        invoice['account_id'] = self.account_receivable.id
        invoice['partner_bank_id'] = False
        return invoice

    # Mocking for 'test_auto_payment_with_token'
    # Avoid account_id is False when creating the invoice
    def _mock_prepare_invoice_line(self, line, fiscal_position):
        line_values = self.original_prepare_invoice_line(line, fiscal_position)
        line_values['account_id'] = self.account_receivable.id
        return line_values

    def test_auto_payment_with_token(self):
        from mock import patch

        self.company = self.env['res.company'].search([], limit=1)

        self.account_type_receivable = self.env['account.account.type'].create(
            {'name': 'receivable',
             'type': 'receivable'})

        self.account_receivable = self.env['account.account'].create(
            {'name': 'Ian Anderson',
             'code': 'IA',
             'user_type_id': self.account_type_receivable.id,
             'company_id': self.company.id,
             'reconcile': True})

        self.sale_journal = self.env['account.journal'].create(
            {'name': 'reflets.info',
            'code': 'ref',
            'type': 'sale',
            'company_id': self.company.id,
            'sequence_id': self.env['ir.sequence'].search([], limit=1).id,
            'default_credit_account_id': self.account_receivable.id,
            'default_debit_account_id': self.account_receivable.id})

        self.partner = self.env['res.partner'].create(
            {'name': 'Stevie Nicks',
             'email': 'sti@fleetwood.mac',
             'property_account_receivable_id': self.account_receivable.id,
             'property_account_payable_id': self.account_receivable.id,
             'company_id': self.company.id,
             'customer': True})

        self.acquirer = self.env['payment.acquirer'].create(
            {'name': 'The Wire',
            'provider': 'transfer',
            'company_id': self.company.id,
            'auto_confirm': 'none',
            'environment': 'test',
            'view_template_id': self.env['ir.ui.view'].search([('type', '=', 'qweb')], limit=1).id})

        self.payment_method = self.env['payment.token'].create(
            {'name': 'Jimmy McNulty',
             'partner_id': self.partner.id,
             'acquirer_id': self.acquirer.id,
             'acquirer_ref': 'Omar Little'})

        self.original_prepare_invoice_data = self.subscription._prepare_invoice_data
        self.original_prepare_invoice_line = self.subscription._prepare_invoice_line

        patchers = [
            patch('odoo.addons.sale_subscription.models.sale_subscription.SaleSubscription._prepare_invoice_line', wraps=self._mock_prepare_invoice_line, create=True),
            patch('odoo.addons.sale_subscription.models.sale_subscription.SaleSubscription._prepare_invoice_data', wraps=self._mock_prepare_invoice_data, create=True),
            patch('odoo.addons.sale_subscription.models.sale_subscription.SaleSubscription._do_payment', wraps=self._mock_subscription_do_payment, create=True),
            patch('odoo.addons.sale_subscription.models.sale_subscription.SaleSubscription.send_success_mail', wraps=self._mock_subscription_send_success_mail, create=True),
        ]

        for patcher in patchers:
            patcher.start()

        self.subscription_tmpl.payment_mandatory = True

        self.subscription.write({
            'partner_id': self.partner.id,
            'recurring_next_date': fields.Date.to_string(datetime.date.today()),
            'template_id': self.subscription_tmpl.id,
            'company_id': self.company.id,
            'payment_token_id': self.payment_method.id,
            'recurring_invoice_line_ids': [(0, 0, {'product_id': self.product.id, 'name': 'TestRecurringLine', 'price_unit': 50, 'uom_id': self.product.uom_id.id})],
        })
        self.mock_send_success_count = 0
        # __import__('pudb').set_trace()
        self.subscription.with_context(auto_commit=False)._recurring_create_invoice(automatic=True)
        self.assertEqual(self.mock_send_success_count, 1, 'a mail to the invoice recipient should have been sent')
        self.assertEqual(self.subscription.state, 'open', 'subscription with online payment and a payment method set should stay opened when transaction succeeds')

        for patcher in patchers:
            patcher.stop()

    def test_sub_creation(self):
        """ Test multiple subscription creation from single SO"""
        # Test subscription creation on SO confirm
        self.sale_order_2.action_confirm()
        self.assertEqual(len(self.sale_order_2.order_line.mapped('subscription_id')), 1, 'sale_subscription: subscription should be created on SO confirmation')
        self.assertEqual(self.sale_order_2.subscription_management, 'create', 'sale_subscription: subscription creation should set the SO to "create"')

        # Two product with different subscription template
        self.sale_order_3.action_confirm()
        self.assertEqual(len(self.sale_order_3.order_line.mapped('subscription_id')), 2, 'sale_subscription: Two different subscription should be created on SO confirmation')
        self.assertEqual(self.sale_order_3.subscription_management, 'create', 'sale_subscription: subscription creation should set the SO to "create"')

        # Two product with same subscription template
        self.sale_order_4.action_confirm()
        self.assertEqual(len(self.sale_order_4.order_line.mapped('subscription_id')), 1, 'sale_subscription: One subscription should be created on SO confirmation')
        self.assertEqual(self.sale_order_4.subscription_management, 'create', 'sale_subscription: subscription creation should set the SO to "create"')

    def test_renewal(self):
        """ Test subscription renewal """
        res = self.subscription.prepare_renewal_order()
        renewal_so_id = res['res_id']
        renewal_so = self.env['sale.order'].browse(renewal_so_id)
        self.assertTrue(renewal_so.subscription_management == 'renew', 'sale_subscription: renewal quotation generation is wrong')
        self.subscription.write({'recurring_invoice_line_ids': [(0, 0, {'product_id': self.product.id, 'name': 'TestRecurringLine', 'price_unit': 50, 'uom_id': self.product.uom_id.id})]})
        renewal_so.write({'order_line': [(0, 0, {'product_id': self.product.id, 'subscription_id': self.subscription.id, 'name': 'TestRenewalLine', 'product_uom': self.product.uom_id.id})]})
        renewal_so.action_confirm()
        lines = [line.name for line in self.subscription.mapped('recurring_invoice_line_ids')]
        self.assertTrue('TestRecurringLine' not in lines, 'sale_subscription: old line still present after renewal quotation confirmation')
        self.assertTrue('TestRenewalLine' in lines, 'sale_subscription: new line not present after renewal quotation confirmation')
        self.assertEqual(renewal_so.subscription_management, 'renew', 'sale_subscription: so should be set to "renew" in the renewal process')

    def test_recurring_revenue(self):
        """Test computation of recurring revenue"""
        eq = lambda x, y, m: self.assertAlmostEqual(x, y, msg=m)
        # Initial subscription is $100/y
        self.subscription_tmpl.recurring_rule_type = 'yearly'
        y_price = 100
        self.sale_order.action_confirm()
        subscription = self.sale_order.order_line.mapped('subscription_id')
        eq(subscription.recurring_total, y_price, "unexpected price after setup")
        eq(subscription.recurring_monthly, y_price / 12.0, "unexpected MRR")
        # Change interval to 3 weeks
        subscription.template_id.recurring_rule_type = 'weekly'
        subscription.template_id.recurring_interval = 3
        eq(subscription.recurring_total, y_price, 'total should not change when interval changes')
        eq(subscription.recurring_monthly, y_price * (30 / 7.0) / 3, 'unexpected MRR')


    def test_analytic_account(self):
        """Analytic accounting flow."""
        # analytic account is copied on order confirmation
        self.sale_order_3.analytic_account_id = self.account_1
        self.sale_order_3.action_confirm()
        subscriptions = self.sale_order_3.order_line.mapped('subscription_id')
        for subscription in subscriptions:
            self.assertEqual(self.sale_order_3.analytic_account_id, subscription.analytic_account_id)
            inv = subscription._recurring_create_invoice()
            # invoice lines have the correct analytic account
            self.assertEqual(inv.invoice_line_ids[0].account_analytic_id, subscription.analytic_account_id)
            subscription.analytic_account_id = self.account_2
            # even if changed after the fact
            inv = subscription._recurring_create_invoice()
            self.assertEqual(inv.invoice_line_ids[0].account_analytic_id, subscription.analytic_account_id)
