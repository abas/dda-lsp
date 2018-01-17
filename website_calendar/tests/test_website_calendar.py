# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime
from dateutil.relativedelta import relativedelta

from odoo.tests import common


class WebsiteCalendarTest(common.HttpCase):

    def setUp(self):
        super(WebsiteCalendarTest, self).setUp()
        self.company = self.env['res.company'].search([], limit=1)

        self.resource_calendar = self.env['resource.calendar'].create({
            'name': 'Small Day',
            'company_id': self.company.id
        })

        self.resource_calendar.write({'attendance_ids': [(5, False, False)]})  # Wipe out all attendances

        self.attendance = self.env['resource.calendar.attendance'].create({
            'name': 'monday morning',
            'dayofweek': '0',
            'hour_from': 8,
            'hour_to': 12,
            'calendar_id': self.resource_calendar.id
        })

        self.first_user_in_brussel = self.env['res.users'].search([], limit=1)
        self.first_user_in_brussel.write({'tz': 'Europe/Brussels'})

        self.second_user_in_australia = self.env['res.users'].search([('id', '!=', self.first_user_in_brussel.id)], limit=1)
        self.second_user_in_australia.write({'tz': 'Australia/West'})

        self.employee = self.env['hr.employee'].create({
            'name': 'Grace Slick',
            'user_id': self.first_user_in_brussel.id,
            'company_id': self.company.id,
            'resource_calendar_id': self.resource_calendar.id
        })

        self.appointment_in_brussel = self.env['calendar.appointment.type'].create({
            'name': 'Go ask Alice',
            'appointment_duration': 1,
            'min_schedule_hours': 1,
            'max_schedule_days': 15,
            'min_cancellation_hours': 1,
            'appointment_tz': 'Europe/Brussels',
            'employee_ids': [(4, self.employee.id, False)],
            'slot_ids': [(0, False, {'weekday': 1, 'hour': 9})]  # Yes, monday has either 0 or 1 as weekday number depending on the object it's in
        })

    def test_extreme_timezone_delta(self):
        context_australia = {'uid': self.second_user_in_australia.id,
                             'tz': self.second_user_in_australia.tz,
                             'lang': 'en_US'}

        # As if the second user called the function
        appointment = self.appointment_in_brussel.with_context(context_australia)

        # Do what the controller actually does 
        months = appointment.sudo()._get_appointment_slots('Europe/Brussels', None)

        # Verifying
        utc_now = datetime.utcnow()
        mondays_count = 0
        for month in months:
            for week in month['weeks']:
                for day in week:
                    # For the sake of this test NOT to break each monday,
                    # we only control those mondays that are *strictly* superior than today
                    if day['day'] > utc_now.date() and day['day'] <= (utc_now + relativedelta(days=appointment.max_schedule_days)).date() and day['day'].weekday() == 0:
                        mondays_count += 1
                        self.assertEqual(len(day['slots']), 1, 'Each monday should have only one slot')
                        slot = day['slots'][0]
                        self.assertEqual(slot['employee_id'], self.employee.id, 'The right employee should be available on each slot')
                        self.assertEqual(slot['hours'], '09:00', 'Slots hours has to be 09:00')  # We asked to display the slots as Europe/Brussels

        # Ensuring that we've gone through the *crucial* asserts at least once
        # It might be more accurate to assert mondays_count >= 2, but we don't want this test to break when it pleases
        self.assertGreaterEqual(mondays_count, 1, 'There should be at least one monday in the time range')