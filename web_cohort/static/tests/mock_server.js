odoo.define('web_cohort.MockServer', function (require) {
'use strict';

var MockServer = require('web.MockServer');

MockServer.include({
    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * @override
     * @private
     * @returns {Deferred}
     */
    _performRpc: function (route, args) {
        if (args.method === 'get_cohort_data') {
            return this._mockGetCohortData(args.model, args.kwargs);
        } else {
            return this._super(route, args);
        }
    },

    /**
     * @private
     * @param {string} model
     * @param {Object} kwargs
     * @returns {Deferred}
     */
    _mockGetCohortData: function (model, kwargs) {
        var self = this;
        var displayFormats = {
            'day': 'DD MMM YYYY',
            'week': 'ww YYYY',
            'month': 'MMMM YYYY',
            'year': 'Y',
        };
        var rows = [];
        var totalValue = 0;
        var columnsAvg = {};

        var groups = this._mockReadGroup(model, {
            domain: kwargs.domain,
            fields: [kwargs.date_start],
            groupby: [kwargs.date_start + ':' + kwargs.interval],
        });
        _.each(groups, function (group) {
            var format;
            switch (kwargs.interval) {
                case 'day':
                    format = 'YYYY-MM-DD';
                    break;
                case 'week':
                    format = 'ww YYYY';
                    break;
                case 'month':
                    format = 'MMMM YYYY';
                    break;
                case 'year':
                    format = 'Y';
                    break;
            }
            var cohortStartDate = moment(group[kwargs.date_start + ':' + kwargs.interval], format);

            var records = self._mockSearchReadController({
                model: model,
                domain: group.__domain,
            });
            var value = 0;
            if (kwargs.measure === '__count__') {
                value = records.length;
            } else {
                if (records.length) {
                    value = _.pluck(records.records, kwargs.measure).reduce(function (a, b) {
                        return a + b;
                    });
                }
            }
            totalValue += value;

            var columns = [];
            var colStartDate = cohortStartDate.clone();
            for (var column = 0; column <= 15; column++) {
                if (!columnsAvg[column]) {
                    columnsAvg[column] = {'percentage': 0, 'count': 0};
                }
                if (column !== 0) {
                    colStartDate.add(1, kwargs.interval);
                }
                if (colStartDate > moment()) {
                    columnsAvg[column]['percentage'] += 0;
                    columnsAvg[column]['count'] += 0;
                    columns.push({
                        'value': '-',
                        'churn_value': '-',
                        'percentage': '-',
                    });
                    continue;
                }

                var compareDate = colStartDate.format(displayFormats[kwargs.interval]);
                var colRecords = _.filter(records.records, function (record) {
                    return record[kwargs.date_stop] && moment(record[kwargs.date_stop], 'YYYY-MM-DD').format(displayFormats[kwargs.interval]) == compareDate;
                });
                var colValue = 0;
                if (kwargs.measure === '__count__') {
                    colValue = colRecords.length;
                } else {
                    if (colRecords.length) {
                        colValue = _.pluck(colRecords, kwargs.measure).reduce(function (a, b) {
                            return a + b;
                        });
                    }
                }

                var previousValue = column === 0 ? value : columns[column - 1]['value'];
                var remainingValue = previousValue - colValue;
                var previousChurnValue = column === 0 ? 0 : columns[column - 1]['churn_value'];
                var churnValue = colValue + previousChurnValue;
                var percentage = value ? parseFloat(remainingValue / value) : 0;
                if (kwargs.mode === 'churn') {
                    percentage = 1 - percentage;
                }
                percentage = (100 * percentage).toFixed(1);
                columnsAvg[column]['percentage'] += percentage;
                columnsAvg[column]['count'] += 1;
                columns.push({
                    'value': remainingValue,
                    'churn_value': churnValue,
                    'percentage': percentage,
                    'domain': [],
                });
            }
            rows.push({
                'date': cohortStartDate.format(displayFormats[kwargs.interval]),
                'value': value,
                'domain': group.__domain,
                'columns': columns,
            });
        });

        return $.when({
            'rows': rows,
            'total': {'total_value': totalValue, 'columns_avg': columnsAvg},
        });
    },
});

});
