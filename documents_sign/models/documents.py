# -*- coding: utf-8 -*-
from odoo import models, fields, api, exceptions


class IrAttachment(models.Model):
    _name = 'ir.attachment'
    _inherit = 'ir.attachment'

    @api.multi
    def write(self, vals):
        self.check('write', values=vals)
        if not vals.get('folder_id'):
            if vals.get('res_model') == 'sign.template' or vals.get('res_model') == 'sign.request':
                folder = self.env.user.company_id.sign_folder
                if folder.exists():
                    vals.update(folder_id=folder.id)
        return super(IrAttachment, self).write(vals)