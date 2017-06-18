# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from binascii import a2b_base64
import logging
import re
import requests
from xml.etree import ElementTree as etree
from werkzeug.urls import url_join


from odoo import _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


def _grams(kilograms):
    return int(kilograms * 1000)


class BpostRequest():

    def __init__(self, prod_environment):
        if prod_environment:
            self.base_url = 'https://api-parcel.bpost.be/services/shm/'
        else:
            self.base_url = 'https://api-parcel.bpost.be/services/shm/'

    def check_required_value(self, recipient, delivery_nature, shipper, order=False, picking=False):
        recipient_required_fields = ['city', 'zip', 'country_id']
        if not recipient.street and not recipient.street2:
            recipient_required_fields.append('street')
        shipper_required_fields = ['city', 'zip', 'country_id']
        if not shipper.street and not shipper.street2:
            shipper_required_fields.append('street')

        res = [field for field in recipient_required_fields if not recipient[field]]
        if res:
            raise ValidationError(_("The recipient address is incomplete or wrong (Missing field(s):  \n %s)") % ", ".join(res).replace("_id", ""))
        if recipient.country_id.code == "BE" and delivery_nature == 'International':
            raise ValidationError(_("bpost International is used only to ship outside Belgium. Please change the delivery method into bpost Domestic."))
        if recipient.country_id.code != "BE" and delivery_nature == 'Domestic':
            raise ValidationError(_("bpost Domestic is used only to ship inside Belgium. Please change the delivery method into bpost International."))

        res = [field for field in shipper_required_fields if not shipper[field]]
        if res:
            raise ValidationError(_("The address of your company is incomplete or wrong (Missing field(s):  \n %s)") % ", ".join(res).replace("_id", ""))
        if shipper.country_id.code != 'BE':
            raise ValidationError(_("Your company/warehouse address must be in Belgium to ship with bpost"))

        if order:
            if order.order_line and all(order.order_line.mapped(lambda l: l.product_id.type in ['service', 'digital'])):
                raise ValidationError(_("The estimated shipping price cannot be computed because all your products are service/digital."))
            if not order.order_line:
                raise ValidationError(_("Please provide at least one item to ship."))
            if order.order_line.filtered(lambda line: not line.product_id.weight and not line.is_delivery and line.product_id.type not in ['service', 'digital']):
                raise ValidationError(_('The estimated shipping cannot be computed because the weight of your product is missing.'))
        return True

    def _parse_address(self, partner):
        streetName = None
        number = None
        if partner.country_id.code == 'BE':
            # match the first or the last number of an address
            # for Belgian "boîte/bus", they should be put in street2
            # so that if you live "Rue du 40e régiment 12", 12 is returned
            ex = re.compile(r'^\d+|\d+$')
        else:
            # match the first number in street because we don't know other
            # countries rules
            ex = re.compile(r'\d+')
        number = ex.search(partner.street).group(0)
        streetName = u'%s %s' % (partner.street.replace(number, ''), partner.street2 if partner.street2 else '')
        return (streetName, number)

    def rate(self, order, carrier):
        weight = sum([(line.product_id.weight * line.product_qty) for line in order.order_line]) or 0.0
        return self._get_rate(carrier, weight, order.partner_shipping_id.country_id)

    def _get_rate(self, carrier, weight, country):
        '''@param carrier: a record of the delivery.carrier
           @param weight: in kilograms
           @param country: a record of the destination res.country'''

        # Surprisingly, bpost does not require to send other data while asking for prices;
        # they simply return a price grid for all activated products for this account.
        code, response = self._send_request('rate', None, carrier)
        xml_response = etree.fromstring(response)

        # Find price by product and country
        price = 0.0
        ns = {'ns1': 'http://schema.post.be/shm/deepintegration/v3/'}
        bpost_delivery_type = carrier.bpost_domestic_deliver_type if carrier.bpost_delivery_nature == 'Domestic' else carrier.bpost_international_deliver_type
        for delivery_method in xml_response.findall('ns1:deliveryMethod/[@name="home or office"]/ns1:product/[@name="%s"]/ns1:price' % bpost_delivery_type, ns):
            if delivery_method.attrib['countryIso2Code'] == country.code:
                price = float(self._get_price_by_weight(_grams(weight), delivery_method))
        if not price:
            raise ValidationError(_("bpost did not return prices for this destination country."))

        # If delivery on saturday is enabled, there are additional fees
        additional_fees = 0.0
        if carrier.bpost_saturday is True:
            for option_price in xml_response.findall('ns1:deliveryMethod/[@name="home or office"]/ns1:product/[@name="%s"]/ns1:option/[@name="Saturday"]' % bpost_delivery_type, ns):
                additional_fees = float(option_price.attrib['price'])

        return price + additional_fees

    def _get_price_by_weight(self, weight, price):
        if weight <= 2000:
            return price.attrib['priceLessThan2']
        elif weight <= 5000:
            return price.attrib['price2To5']
        elif weight <= 10000:
            return price.attrib['price5To10']
        elif weight <= 20000:
            return price.attrib['price10To20']
        elif weight <= 30000:
            return price.attrib['price20To30']
        else:
            raise ValidationError(_("Packages over 30 Kg are not accepted by bpost."))

    def send_shipping(self, picking, carrier):
        # Get price of label
        price = self._get_rate(carrier, picking.shipping_weight, picking.partner_id.country_id)

        # Announce shipment to bpost
        reference_id = str(picking.name.replace("/", "", 2))[:50]
        ss, sn = self._parse_address(picking.company_id)
        rs, rn = self._parse_address(picking.partner_id)
        values = {'accountId': carrier.sudo().bpost_account_number,
                  'reference': reference_id,
                  'sender': {'_record': picking.company_id,
                             'streetName': ss,
                             'number': sn,
                             },
                  'receiver': {'_record': picking.partner_id,
                               'company': picking.partner_id.commercial_partner_id.name if picking.partner_id.commercial_partner_id != picking.partner_id else '',
                               'streetName': rs,
                               'number': rn,
                               },
                  'is_domestic': carrier.bpost_delivery_nature == 'Domestic',
                  'weight': str(_grams(picking.shipping_weight)),
                  # domestic
                  'product': carrier.bpost_domestic_deliver_type,
                  'saturday': carrier.bpost_saturday,
                  # international
                  'international_product': carrier.bpost_international_deliver_type,
                  'parcelValue': int(picking.sale_id.amount_total),
                  'contentDescription': '\n'.join(["%d %s" % (move.product_qty, move.product_id.name) for move in picking.move_lines]),
                  'shipmentType': carrier.bpost_shipment_type,
                  'parcelReturnInstructions': carrier.bpost_parcel_return_instructions,
                  }
        xml = carrier.env['ir.qweb'].render('delivery_bpost.bpost_shipping_request', values)
        code, response = self._send_request('send', xml, carrier)
        if code != 201 and response:
            root = etree.fromstring(response)
            ns = {'ns1': 'http://schema.post.be/shm/deepintegration/v3/'}
            for errors_return in root.findall("ns1:error", ns):
                raise ValidationError(errors_return.text)

        # Grab printable label and tracking code
        code, response2 = self._send_request('label', None, carrier, reference=reference_id)
        root = etree.fromstring(response2)
        ns = {'ns1': 'http://schema.post.be/shm/deepintegration/v3/'}
        for labels in root.findall('ns1:label', ns):
            tracking_code = labels.find("ns1:barcode", ns).text
            databytes = labels.find("ns1:bytes", ns).text
            label = databytes

        return {'price': price, 'tracking_code': tracking_code, 'label': a2b_base64(label)}

    def _send_request(self, action, xml, carrier, reference=None):
        supercarrier = carrier.sudo()
        passphrase = supercarrier._bpost_passphrase()
        METHODS = {'rate': 'GET',
                   'send': 'POST',
                   'label': 'GET'}
        HEADERS = {'rate': {'authorization': 'Basic %s' % passphrase,
                            'accept': 'application/vnd.bpost.shm-productConfiguration-v3.1+XML'},
                   'send': {'authorization': 'Basic %s' % passphrase,
                            'content-Type': 'application/vnd.bpost.shm-order-v3.3+XML'},
                   'label': {'authorization': 'Basic %s' % passphrase,
                             'accept': 'application/vnd.bpost.shm-label-%s-v3+XML' % ('pdf' if carrier.bpost_label_format == 'PDF' else 'image'),
                             'content-Type': 'application/vnd.bpost.shm-labelRequest-v3+XML'}}
        URLS = {'rate': url_join(self.base_url, '%s/productconfig' % supercarrier.bpost_account_number),
                'send': url_join(self.base_url, '%s/orders' % supercarrier.bpost_account_number),
                'label': url_join(self.base_url, '%s/orders/%s/labels/%s' % (supercarrier.bpost_account_number, reference, carrier.bpost_label_stock_type))}

        response = requests.request(METHODS[action], URLS[action], headers=HEADERS[action], data=xml)

        if 400 <= response.status_code <= 599:
            _logger.debug('HTTP Request headers:\n%s' % HEADERS[action])
            _logger.debug('HTTP Request XML payload:\n%s' % xml)
            _logger.debug('HTTP Response:\n%s' % response.status_code)
            _logger.debug('HTTP Response:\n%s' % response.text)
        return response.status_code, response.text