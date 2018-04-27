# -*- coding: utf-8 -*-

import json
import logging
import re
import time
import threading
import uuid

import itertools
import requests
from html2text import html2text
from requests.exceptions import ConnectionError

from odoo import api, models
from odoo.modules.registry import Registry

FCM_MESSAGES_LIMIT = 1000
FCM_END_POINT = "https://fcm.googleapis.com/fcm/send"
FCM_RETRY_ATTEMPT = 2
_logger = logging.getLogger(__name__)


class MailMessage(models.Model):
    _inherit = 'mail.message'

    @api.multi
    def _notify_recipients(self, rdata, record, msg_vals, **kwargs):
        """ We want to send a Cloud notification for every mentions of a partner and every direct
        message. We have to take into account the risk of duplicated notifications in case of a
        mention in a channel of `chat` type.
        """
        super(MailMessage, self)._notify_recipients(rdata, record, msg_vals, **kwargs)

        self_sudo = self.sudo()

        # Create Cloud messages for messages in a chat
        if self_sudo.message_type == 'comment':
            receiver_ids = self_sudo.needaction_partner_ids

            for channel in self_sudo.channel_ids.filtered(lambda c: c.channel_type == 'chat'):
                receiver_ids |= channel.channel_partner_ids - self_sudo.author_id

            # Create Cloud messages for needactions, but ignore the needaction if it is a result
            # of a mention in a chat. In this case the previously created Cloud message is enough.
            identities = receiver_ids.sudo().mapped('device_identity_ids')
            if identities:
                for service, service_str in self.env['mail_push.device']._default_service_type():
                    method_name = "_push_notify_%s" % (service)
                    if hasattr(self, method_name):
                        method = getattr(self_sudo, method_name)
                        service_identities = identities.filtered(lambda r: r.service_type == service)
                        method(service_identities)

    def _get_default_fcm_credentials(self):
        params = self.env['ir.config_parameter'].sudo()
        return dict(
            mail_push_notification=params.get_param('mail_push.mail_push_notification', default=False),
            fcm_api_key=params.get_param('mail_push.fcm_api_key', default=''),
            fcm_project_id=params.get_param('mail_push.fcm_project_id', default=''),
        )

    @api.model
    def _push_notify_fcm(self, identities):
        # Divided into chunks because FCM supports only 1000 users in multi-cast
        identities_chunks = [identities[i:i+FCM_MESSAGES_LIMIT] for i in range(0, len(identities), FCM_MESSAGES_LIMIT)]
        payload = self._fcm_prepare_payload()
        for identities in identities_chunks:
            subscription_ids = identities.mapped('subscription_id')
            fcm_api_key = self._get_default_fcm_credentials()['fcm_api_key']
            threaded_sending = threading.Thread(target=self._fcm_send_notification, args=(
                subscription_ids,
                payload,
                self.env.cr.dbname,
                self.env.uid,
                fcm_api_key
            ))
            threaded_sending.start()

    def _fcm_send_notification(self, subscription_ids, payload, dbname, uid, fcm_api_key, attempt=1):
        res = None
        if not fcm_api_key:
            _logger.exception("You need a FCM API key to send notification")
            return

        headers = {
            "Content-Type": "application/json",
            "Authorization": "key=" + fcm_api_key,
        }
        data = {
            'data': payload,
            'registration_ids': subscription_ids,
            'priority': 'high',
            'content_available': True,
            # ios not supporting background push notification without notification data
            'notification': {
                'title': payload['subject'],
                'body': "%s: %s" % (payload['author_name'], payload['body']),
                'sound': 'default',
                # tag : Identifier used to replace existing notifications in the notification drawer.
                # If not specified, each request creates a new notification.
                # If specified and a notification with the same tag is already being shown,
                # the new notification replaces the existing one in the notification drawer.
                'tag': "%s_%s" % (payload['model'], payload['res_id']),
            },
        }
        res = {}

        try:
            response = requests.post(FCM_END_POINT, headers=headers, data=json.dumps(data))
            if response.status_code == 200:
                res = self._fcm_process_response(response, subscription_ids)
            elif response.status_code == 401:
                _logger.warning("FCM Authentication: Provide valid FCM api key")
            elif response.status_code == 400:
                _logger.warning("Invalid JSON: Invalid payload format")
            else:
                retry = self._fcm_calculate_retry_after(response.headers)
                if retry and attempt <= FCM_RETRY_ATTEMPT:
                    _logger.warning("FCM Service Unavailable: retrying")
                    time.sleep(retry)
                    attempt = attempt + 1
                    self._fcm_send_notification(subscription_ids, payload, dbname, uid, fcm_api_key, attempt=attempt)
                else:
                    _logger.warning("FCM service not available try after some time")
        except ConnectionError:
            _logger.warning("No Internet connection")
        except Exception:
            _logger.warning("Failed processing FCM queue")

        if res.get('errors') or res.get('canonical'):
            with api.Environment.manage():
                with Registry(dbname).cursor() as cr:
                    env = api.Environment(cr, uid, {})
                    if res.get('errors'):
                        self._fcm_process_errors(res['errors'], env)
                    if res.get('canonical'):
                        self._fcm_process_canonical(res['canonical'], env)

    @api.model
    def _get_mobile_push_uuid(self):
        push_uuid = self.env['ir.config_parameter'].sudo().get_param('mobile.uuid')
        if not push_uuid:
            push_uuid = str(uuid.uuid4())
            self.env['ir.config_parameter'].sudo().set_param('mobile.uuid', push_uuid)
        return push_uuid

    @api.model
    def _fcm_prepare_payload(self):
        """Returns dictionary containing message information for mobile device. This info will be delivered
        to mobile device via Google Firebase Cloud Messaging(FCM). And it is having limit of 4000 bytes (4kb)
        """
        payload = {
            "author_name": self.author_id.name,
            "model": self.model,
            "res_id": self.res_id,
            "db_id": self._get_mobile_push_uuid()
        }
        if self.model == 'mail.channel':
            channel = self.channel_ids.filtered(lambda r: r.id == self.res_id)
            if channel.channel_type == 'chat':
                payload['subject'] = self.author_id.name
                payload['type'] = 'chat'
            else:
                payload['subject'] = "#%s" % (self.record_name)
        else:
            payload['subject'] = self.record_name or self.subject
        payload_length = len(str(payload).encode("utf-8"))
        if payload_length < 4000:
            body = re.sub(r'<a(.*?)>', r'<a>', self.body)  # To-Do : Replace this fix
            payload['body'] = html2text(body)[:4000-payload_length]
        return payload

    @api.model
    def _fcm_process_response(self, res, subscription_ids):
        response = res.json()
        errors = {}
        canonical = {}
        if response.get('canonical_ids') or response.get('failure'):
            results = response.get('results', [])
            for index, result in enumerate(results):
                error_type = result.get('error')
                if error_type:
                    if error_type not in errors:
                        errors[error_type] = []
                    errors[error_type].append(subscription_ids[index])
                if result.get('registration_id'):
                    canonical[subscription_ids[index]] = result['registration_id']
        return {
            'errors': errors,
            'canonical': canonical
        }

    @api.model
    def _fcm_process_errors(self, errors, env):
        """We will delete wrong/unregistered subscription tokens.
        This function will handle following errors. Other errors like
        Authentication,Unavailable will be handled by FCM
            > InvalidRegistration: Due to wrong subscription token
            > MismatchSenderId: Sent through wrong sender probably due to change in api key
            > NotRegistered: Subscription token unregistered from device
        """
        invalid_subscriptions = []
        for e in ["InvalidRegistration", "MismatchSenderId", "NotRegistered"]:
            invalid_subscriptions += errors.get(e, [])
        subscription_to_remove = env['mail_push.device'].sudo().search([('subscription_id', 'in', invalid_subscriptions)])
        subscription_to_remove.unlink()

    @api.model
    def _fcm_process_canonical(self, canonical, env):
        """ If user have multiple registrations for the same device and you try to send
        a message using an old registration token, FCM will process the request as usual,
        but it includes the canonical ID in the response. We will delete/replace such token.
        Response Format: {'new_token': 'old_token'}
        """
        all_subsciptions = list(itertools.chain(canonical, canonical.values()))
        subscription_exists = env['mail_push.device'].sudo().search([('subscription_id', 'in', all_subsciptions)])
        token_exists = subscription_exists.mapped("subscription_id")
        for old, new in canonical.items():
            if old in token_exists and new in token_exists:
                subscription_exists.filtered(lambda r: r.subscription_id == old).unlink()
            elif old in token_exists and new not in token_exists:
                subscription_exists.filtered(lambda r: r.subscription_id == old).write({'subscription_id': new})

    def _fcm_calculate_retry_after(self, response_headers):
        retry_after = response_headers.get('Retry-After')

        if retry_after:
            # Parse from seconds (e.g. Retry-After: 120)
            if type(retry_after) is int:
                return retry_after
            # Parse from HTTP-Date (e.g. Retry-After: Fri, 31 Dec 1999 23:59:59 GMT)
            else:
                try:
                    from email.utils import parsedate
                    from calendar import timegm
                    return timegm(parsedate(retry_after))
                except (TypeError, OverflowError, ValueError):
                    return None
        return None
