# -*- coding: utf-8 -*-

{
    'name': "Timesheets Validation",
    'summary': "Timesheet Validation and Grid View",
    'description': """
* Timesheet submission and validation
* Activate grid view for timesheets
    """,

    'version': '1.0',
    'depends': ['web_grid', 'hr_timesheet'],
    'data': [
        'data/timesheet_data.xml',
        'security/timesheet_security.xml',
        'views/views.xml',
        'views/res_config_views.xml',
    ],
    'auto_install': True,
}
