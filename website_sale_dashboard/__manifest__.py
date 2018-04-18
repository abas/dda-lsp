{
    'name': 'Website Sale Dashboard',
    'category': 'Website',
    'sequence': 55,
    'summary': 'Get a new dashboard view in the Website App',
    'version': '1.0',
    'description': """

This module adds a new dashboard view in the Website application.
This new type of view contains some basic statistics, a graph, and
a pivot subview that allow you to get a quick overview of your online sales.
It also provides new tools to analyse your data

""",
    'depends': ['website_sale', 'web_dashboard'],
    'data': [
        'views/dashboard_view.xml',
        'views/assets.xml',
    ],
    'qweb': ['static/src/xml/*.xml'],
    'auto_install': True,
}