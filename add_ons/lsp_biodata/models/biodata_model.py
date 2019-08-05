# -*- coding: utf-8 -*-
from odoo import fields, models

class Biodata(models.Model):
  _name = 'biodata.s'
  _description = 'Biodata Description'

  nim = fields.Char(string='Nim', required=True)
  nik = fields.Char(string='Nik', required=True)
  name = fields.Char(string='Name', required=True)
  alamat = fields.Char(string='Alamat', required=True)
  email = fields.Char(string='Email', required=True)
  # is_done = fields.Boolean('Done?')
  # active = fields.Boolean(string='Active?', default=True)
  user_id = fields.Many2one('res.users', string='Responsible', default=lambda self: self.env.user)
  # teams_ids = fields.Many2many('res.biodata', string='Tim Bio')

  _sql_constraints = [
    ('nim_unique',
      'UNIQUE(nim)',
      "The NIM must be unique"),
    ('nik_unique',
      'UNIQUE(nik)',
      "The NIK must be unique"),
    ('email_unique',
      'UNIQUE(email)',
      "The EMAIL must be unique"),
  ]