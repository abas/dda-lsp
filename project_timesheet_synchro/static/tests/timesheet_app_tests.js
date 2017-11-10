odoo.define('project_timesheet_synchro.timesheet_app_tests', function (require) {
    "use strict";
    var TimeSheetUI = require('project_timeshee.ui');
    var concurrency = require('web.concurrency');

    QUnit.module('project_timesheet_synchro', {
        beforeEach: function () {
            this.data = {
                projects: {
                    fields: {
                        name: {string: "Project Name", type: "char" },
                        use_tasks: {string: "Use Tasks", type: "boolean" },
                        allow_timesheets: {string: "Allow Timesheets", type: "boolean" },
                    },
                    records: [{
                        id: "1",
                        name: "Project 1",
                        use_tasks: true,
                        allow_timesheets: true
                    }, {
                        id: "2",
                        name: "Project 2",
                        use_tasks: true,
                        allow_timesheets: true
                    }, ]
                },
                tasks: {
                    fields: {
                        name: {string: "Task Title", type: "char" },
                        sequence: {string: "sequence", type: "integer" },
                        kanban_state: {string: "State", type: "selection", selection: [["abc", "ABC"],["def", "DEF"],["ghi", "GHI"]] },
                        project_id: {string: "Project", type: 'many2one', relation: 'project.project' },
                    },
                    records: [{
                        id: "1",
                        name: "task1",
                        project_id: "1",
                        sequence: "1",
                        kanban_state: "abc"
                    }, {
                        id: "2",
                        name: "task2",
                        project_id: "2",
                        sequence: "2",
                        kanban_state: "abc"
                    }, ]
                },
                account_analytic_lines: {
                    fields: {
                        project_id: {string: "Project",type: "many2one" },
                        task_id: {string: "Task", type: "many2one" },
                        date: {string: "Date", type: "date" },
                        unit_amount: {string: "Time Spent", type: "float" },
                        name: {string: "Descriprion", type: "char" },
                    },
                    records: [{
                        id: "1",
                        project_id: "1",
                        task_id: "1",
                        date: "2017-08-21",
                        unit_amount: "03.50",
                        desc: "Test"
                    }, {
                        id: "2",
                        project_id: "1",
                        task_id: "2",
                        date: "2017-08-18",
                        unit_amount: "03.50",
                        desc: "Test"
                    }, {
                        id: "3",
                        project_id: "2",
                        task_id: "2",
                        date: "2017-08-15",
                        unit_amount: "03.50",
                        desc: "Test"
                    }, ]
                },
            };
        }
    }, function () {

        QUnit.module('TimeSheetUI');

        QUnit.test('timesheet_app_tests', function (assert) {
            var done = assert.async();
            assert.expect(6);
            var self = this;
            var projectTimesheet = new TimeSheetUI();
            projectTimesheet.data = {};
            projectTimesheet.appendTo($('#qunit-fixture')).then(function () {
                projectTimesheet.data.projects = self.data.projects.records; //projects
                projectTimesheet.data.tasks = self.data.tasks.records; // tasks
                projectTimesheet.data.account_analytic_lines = self.data.account_analytic_lines.records; //time sheets
                projectTimesheet.activities_screen.make_activities_list();

                /*Start & Stop Timer*/
                projectTimesheet.activities_screen.start_timer();
                concurrency.delay(0).then(function () {
                    projectTimesheet.activities_screen.stop_timer();

                    //select project
                    projectTimesheet.$('.pt_activity_project').select2("open");
                    $('.select2-results li div').first().trigger('mouseup');

                    //select task
                    projectTimesheet.$('.pt_activity_task').select2("open");
                    $('.select2-results li div').first().trigger('mouseup');

                    $('.pt_activity_duration').val("0.25"); // set time spent
                    $('.pt_activity_duration').trigger('change');

                    $('textarea.pt_description').val("Test"); //set description
                    $('textarea.pt_description').trigger('change');

                    projectTimesheet.edit_activity_screen.save_changes(); //save record

                    assert.strictEqual($('.pt_project').first().text(), "Project 1", "Should contain project named 'Project 1'");
                    assert.strictEqual($('.pt_task').first().text().trim(), "task1", "Should contain task named 'task 1'");
                    assert.strictEqual($('.pt_duration_time').first().text().trim(), "00:15", "time spent should be 00:15");
                    $('.pt_quick_subtract_time').trigger('click');
                    assert.strictEqual($('.pt_duration_time').first().text().trim(), "00:00", "time spent should now be 00:00");
                    $('.pt_quick_subtract_time').trigger('click');
                    assert.strictEqual($('.pt_deletion_from_list_modal').length, 1, "Should open a modal with delete button");
                    $('.pt_delete_activity').trigger('click');
                    assert.strictEqual($('.pt_activities_list tr').length, 0, "Should display 0 timesheet");
                    projectTimesheet.reset_app();
                    projectTimesheet.destroy();
                    done();
                });
            });
        });
    });
});