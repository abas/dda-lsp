# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

import re

from odoo import api, fields, models
from odoo.tools import pycompat


class SignTemplate(models.Model):
    _name = "sign.template"
    _description = "Signature Template"
    _rec_name = "attachment_id"

    attachment_id = fields.Many2one('ir.attachment', string="Attachment", required=True, ondelete='cascade')
    name = fields.Char(related='attachment_id.name')
    datas = fields.Binary(related='attachment_id.datas')
    sign_item_ids = fields.One2many('sign.item', 'template_id', string="Signature Items")

    active = fields.Boolean(default=True, string="Active", oldname='archived')
    favorited_ids = fields.Many2many('res.users', string="Favorite of")

    share_link = fields.Char(string="Share Link")

    sign_request_ids = fields.One2many('sign.request', 'template_id', string="Signature Requests")

    tag_ids = fields.Many2many('sign.template.tag', string='Tags')
    color = fields.Integer()

    @api.multi
    def go_to_custom_template(self):
        self.ensure_one()
        return {
            'name': "Template \"%(name)s\"" % {'name': self.attachment_id.name},
            'type': 'ir.actions.client',
            'tag': 'sign.Template',
            'context': {
                'id': self.id,
            },
        }

    @api.multi
    def toggle_favorited(self):
        self.ensure_one()
        self.write({'favorited_ids': [(3 if self.env.user in self[0].favorited_ids else 4, self.env.user.id)]})

    @api.model
    def upload_template(self, name=None, dataURL=None, active=True):
        mimetype = dataURL[dataURL.find(':')+1:dataURL.find(',')]
        datas = dataURL[dataURL.find(',')+1:]
        attachment = self.env['ir.attachment'].create({'name': name[:name.rfind('.')], 'datas_fname': name, 'datas': datas, 'mimetype': mimetype})
        template = self.create({'attachment_id': attachment.id, 'favorited_ids': [(4, self.env.user.id)], 'active': active})
        return {'template': template.id, 'attachment': attachment.id}

    @api.model
    def update_from_pdfviewer(self, template_id=None, duplicate=None, sign_items=None, name=None):
        template = self.browse(template_id)
        if not duplicate and len(template.sign_request_ids) > 0:
            return False

        if duplicate:
            new_attachment = template.attachment_id.copy()
            r = re.compile(' \(v(\d+)\)$')
            m = r.search(name)
            v = str(int(m.group(1))+1) if m else "2"
            index = m.start() if m else len(name)
            new_attachment.name = name[:index] + " (v" + v + ")"

            template = self.create({
                'attachment_id': new_attachment.id,
                'favorited_ids': [(4, self.env.user.id)]
            })
        elif name:
            template.attachment_id.name = name

        item_ids = {
            it
            for it in pycompat.imap(int, sign_items)
            if it > 0
        }
        template.sign_item_ids.filtered(lambda r: r.id not in item_ids).unlink()
        for item in template.sign_item_ids:
            item.write(sign_items.pop(str(item.id)))
        SignItem = self.env['sign.item']
        for item in sign_items.values():
            item['template_id'] = template.id
            SignItem.create(item)

        if len(template.sign_item_ids.mapped('responsible_id')) > 1:
            template.share_link = None
        return template.id


class SignTemplateTag(models.Model):

    _name = "sign.template.tag"
    _description = "Sign Template Tag"

    name = fields.Char('Tag Name', required=True, translate=True)
    color = fields.Integer('Color Index')

    _sql_constraints = [
        ('name_uniq', 'unique (name)', "Tag name already exists !"),
    ]


class SignItem(models.Model):
    _name = "sign.item"
    _description = "Signature Field For Document To Sign"

    template_id = fields.Many2one('sign.template', string="Document Template", required=True, ondelete='cascade')

    type_id = fields.Many2one('sign.item.type', string="Type", required=True, ondelete='cascade')

    required = fields.Boolean(default=True)
    responsible_id = fields.Many2one("sign.item.role", string="Responsible")

    name = fields.Char(string="Field Name")
    page = fields.Integer(string="Document Page", required=True, default=1)
    posX = fields.Float(digits=(4, 3), string="Position X", required=True)
    posY = fields.Float(digits=(4, 3), string="Position Y", required=True)
    width = fields.Float(digits=(4, 3), required=True)
    height = fields.Float(digits=(4, 3), required=True)

    @api.multi
    def getByPage(self):
        items = {}
        for item in self:
            if item.page not in items:
                items[item.page] = []
            items[item.page].append(item)
        return items


class SignItemType(models.Model):
    _name = "sign.item.type"
    _description = "Specialized type for signature fields"

    name = fields.Char(string="Field Name", required=True, translate=True)
    type = fields.Selection([
        ('signature', "Signature"),
        ('initial', "Initial"),
        ('text', "Text"),
        ('textarea', "Multiline Text"),
        ('checkbox', "Checkbox"),
    ], required=True, default='text')

    tip = fields.Char(required=True, default="fill in", translate=True)
    placeholder = fields.Char()

    default_width = fields.Float(string="Default Width", digits=(4, 3), required=True, default=0.150)
    default_height = fields.Float(string="Default Height", digits=(4, 3), required=True, default=0.015)
    auto_field = fields.Char(string="Automatic Partner Field", help="Partner field to use to auto-complete the fields of this type")


class SignItemValue(models.Model):
    _name = "sign.item.value"
    _description = "Signature Field Value For Document To Sign"

    sign_item_id = fields.Many2one('sign.item', string="Signature Item", required=True, ondelete='cascade')
    sign_request_id = fields.Many2one('sign.request', string="Signature Request", required=True, ondelete='cascade')

    value = fields.Text()


class SignItemParty(models.Model):
    _name = "sign.item.role"
    _description = "Type of partner which can access a particular signature field"

    name = fields.Char(required=True, translate=True)

    @api.model
    def add(self, name):
        party = self.search([('name', '=', name)])
        return party.id if party else self.create({'name': name}).id