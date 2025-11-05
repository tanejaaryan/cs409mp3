var Task = require('../models/task');
var User = require('../models/user');
var mongoose = require('mongoose');

module.exports = function (router) {
    // Routes for /api/tasks
    var tasksRoute = router.route('/tasks');

    // GET /api/tasks
    tasksRoute.get(function (req, res) {
        try {
            // Parse query parameters
            var where = req.query.where ? JSON.parse(req.query.where) : {};
            var sort = req.query.sort ? JSON.parse(req.query.sort) : {};
            var select = req.query.select ? JSON.parse(req.query.select) : {};
            var skip = req.query.skip ? parseInt(req.query.skip) : 0;
            var limit = req.query.limit ? parseInt(req.query.limit) : 100; // default 100 for tasks
            var count = req.query.count === 'true';

            // Filter out invalid ObjectIds from $in queries to avoid cast errors
            if (where._id && typeof where._id === 'object' && where._id.$in && Array.isArray(where._id.$in)) {
                where._id.$in = where._id.$in.filter(function(id) {
                    return mongoose.Types.ObjectId.isValid(id);
                });
                // If no valid IDs remain, return empty array
                if (where._id.$in.length === 0) {
                    return res.status(200).json({
                        message: "OK",
                        data: count ? 0 : []
                    });
                }
            }

            // Build query
            var query = Task.find(where);
            
            if (Object.keys(sort).length > 0) {
                query = query.sort(sort);
            }
            
            if (Object.keys(select).length > 0) {
                query = query.select(select);
            }
            
            query = query.skip(skip);
            
            if (limit > 0) {
                query = query.limit(limit);
            }

            // Execute query
            if (count) {
                // When count=true, return the count of documents in the result set (respecting skip and limit)
                query.exec(function (err, tasks) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting tasks",
                            data: err.message
                        });
                    }
                    res.status(200).json({
                        message: "OK",
                        data: tasks.length
                    });
                });
            } else {
                query.exec(function (err, tasks) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error retrieving tasks",
                            data: err.message
                        });
                    }
                    // If querying by simple _id (not $in or other operators) and no results found, return 404
                    if (tasks.length === 0 && where._id && typeof where._id === 'string') {
                        return res.status(404).json({
                            message: "Task not found",
                            data: {}
                        });
                    }
                    res.status(200).json({
                        message: "OK",
                        data: tasks
                    });
                });
            }
        } catch (err) {
            return res.status(400).json({
                message: "Bad request - Invalid query parameters",
                data: err.message
            });
        }
    });

    // POST /api/tasks
    tasksRoute.post(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad request - Name and deadline are required",
                data: {}
            });
        }

        var assignedUser = req.body.assignedUser || "";
        var assignedUserName = req.body.assignedUserName || "unassigned";
        var completed = req.body.completed !== undefined ? req.body.completed : false;

        // Validate assignedUser exists if provided
        if (assignedUser && assignedUser !== "") {
            if (!mongoose.Types.ObjectId.isValid(assignedUser)) {
                return res.status(400).json({
                    message: "Bad request - Invalid user ID format",
                    data: {}
                });
            }

            User.findById(assignedUser, function (err, user) {
                if (err) {
                    return res.status(500).json({
                        message: "Error finding user",
                        data: err.message
                    });
                }
                if (!user) {
                    return res.status(404).json({
                        message: "Assigned user not found",
                        data: {}
                    });
                }
                // Set the assignedUserName from the user
                assignedUserName = user.name;
                createTask(user);
            });
        } else {
            createTask(null);
        }

        function createTask(user) {
            var task = new Task();
            task.name = req.body.name;
            task.description = req.body.description || "";
            task.deadline = req.body.deadline;
            task.completed = completed;
            task.assignedUser = assignedUser;
            task.assignedUserName = assignedUserName;

            task.save(function (err, savedTask) {
                if (err) {
                    return res.status(500).json({
                        message: "Error creating task",
                        data: err.message
                    });
                }

                // If task is assigned to a user and not completed, add to user's pendingTasks
                if (user && !savedTask.completed) {
                    if (user.pendingTasks.indexOf(savedTask._id.toString()) === -1) {
                        user.pendingTasks.push(savedTask._id.toString());
                        user.save(function (err) {
                            if (err) {
                                return res.status(500).json({
                                    message: "Error updating user",
                                    data: err.message
                                });
                            }
                            res.status(201).json({
                                message: "Task created",
                                data: savedTask
                            });
                        });
                    } else {
                        res.status(201).json({
                            message: "Task created",
                            data: savedTask
                        });
                    }
                } else {
                    res.status(201).json({
                        message: "Task created",
                        data: savedTask
                    });
                }
            });
        }
    });

    // Routes for /api/tasks/:id
    var taskRoute = router.route('/tasks/:id');

    // GET /api/tasks/:id
    taskRoute.get(function (req, res) {
        try {
            var select = req.query.select ? JSON.parse(req.query.select) : {};
            
            // Validate ObjectId format
            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }

            var query = Task.findById(req.params.id);
            
            if (Object.keys(select).length > 0) {
                query = query.select(select);
            }

            query.exec(function (err, task) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving task",
                        data: err.message
                    });
                }
                if (!task) {
                    return res.status(404).json({
                        message: "Task not found",
                        data: {}
                    });
                }
                res.status(200).json({
                    message: "OK",
                    data: task
                });
            });
        } catch (err) {
            return res.status(400).json({
                message: "Bad request - Invalid query parameters",
                data: err.message
            });
        }
    });

    // PUT /api/tasks/:id
    taskRoute.put(function (req, res) {
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({
                message: "Task not found",
                data: {}
            });
        }

        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad request - Name and deadline are required",
                data: {}
            });
        }

        Task.findById(req.params.id, function (err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding task",
                    data: err.message
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }

            // Store old values
            var oldAssignedUser = task.assignedUser;
            var oldCompleted = task.completed;

            // Update task fields
            task.name = req.body.name;
            task.description = req.body.description || "";
            task.deadline = req.body.deadline;
            task.completed = req.body.completed !== undefined ? req.body.completed : false;
            task.assignedUser = req.body.assignedUser || "";
            task.assignedUserName = req.body.assignedUserName || "unassigned";
            // dateCreated should not be updated

            // Validate assignedUser if provided
            if (task.assignedUser && task.assignedUser !== "") {
                if (!mongoose.Types.ObjectId.isValid(task.assignedUser)) {
                    return res.status(400).json({
                        message: "Bad request - Invalid user ID format",
                        data: {}
                    });
                }

                User.findById(task.assignedUser, function (err, user) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error finding user",
                            data: err.message
                        });
                    }
                    if (!user) {
                        return res.status(404).json({
                            message: "Assigned user not found",
                            data: {}
                        });
                    }

                    // Set the assignedUserName from the user
                    task.assignedUserName = user.name;
                    saveTaskAndUpdateReferences();
                });
            } else {
                saveTaskAndUpdateReferences();
            }

            function saveTaskAndUpdateReferences() {
                task.save(function (err, updatedTask) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error updating task",
                            data: err.message
                        });
                    }

                    // Maintain two-way reference
                    var taskId = req.params.id;
                    var newAssignedUser = updatedTask.assignedUser;
                    var newCompleted = updatedTask.completed;

                    // Remove task from old user's pendingTasks if user changed or task completed
                    if (oldAssignedUser && oldAssignedUser !== "" && 
                        (oldAssignedUser !== newAssignedUser || (!oldCompleted && newCompleted))) {
                        User.findById(oldAssignedUser, function (err, oldUser) {
                            if (!err && oldUser) {
                                var index = oldUser.pendingTasks.indexOf(taskId);
                                if (index > -1) {
                                    oldUser.pendingTasks.splice(index, 1);
                                    oldUser.save(function (err) {
                                        if (err) {
                                            return res.status(500).json({
                                                message: "Error updating old user",
                                                data: err.message
                                            });
                                        }
                                        addTaskToNewUser();
                                    });
                                } else {
                                    addTaskToNewUser();
                                }
                            } else {
                                addTaskToNewUser();
                            }
                        });
                    } else {
                        addTaskToNewUser();
                    }

                    function addTaskToNewUser() {
                        // Add task to new user's pendingTasks if assigned and not completed
                        if (newAssignedUser && newAssignedUser !== "" && !newCompleted && 
                            newAssignedUser !== oldAssignedUser) {
                            User.findById(newAssignedUser, function (err, newUser) {
                                if (err || !newUser) {
                                    return res.status(200).json({
                                        message: "Task updated",
                                        data: updatedTask
                                    });
                                }
                                if (newUser.pendingTasks.indexOf(taskId) === -1) {
                                    newUser.pendingTasks.push(taskId);
                                    newUser.save(function (err) {
                                        if (err) {
                                            return res.status(500).json({
                                                message: "Error updating new user",
                                                data: err.message
                                            });
                                        }
                                        res.status(200).json({
                                            message: "Task updated",
                                            data: updatedTask
                                        });
                                    });
                                } else {
                                    res.status(200).json({
                                        message: "Task updated",
                                        data: updatedTask
                                    });
                                }
                            });
                        } else if (oldCompleted && !newCompleted && newAssignedUser === oldAssignedUser && newAssignedUser !== "") {
                            // Task was completed, now it's not - add back to user's pending tasks
                            User.findById(newAssignedUser, function (err, user) {
                                if (err || !user) {
                                    return res.status(200).json({
                                        message: "Task updated",
                                        data: updatedTask
                                    });
                                }
                                if (user.pendingTasks.indexOf(taskId) === -1) {
                                    user.pendingTasks.push(taskId);
                                    user.save(function (err) {
                                        if (err) {
                                            return res.status(500).json({
                                                message: "Error updating user",
                                                data: err.message
                                            });
                                        }
                                        res.status(200).json({
                                            message: "Task updated",
                                            data: updatedTask
                                        });
                                    });
                                } else {
                                    res.status(200).json({
                                        message: "Task updated",
                                        data: updatedTask
                                    });
                                }
                            });
                        } else {
                            res.status(200).json({
                                message: "Task updated",
                                data: updatedTask
                            });
                        }
                    }
                });
            }
        });
    });

    // DELETE /api/tasks/:id
    taskRoute.delete(function (req, res) {
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({
                message: "Task not found",
                data: {}
            });
        }

        Task.findByIdAndRemove(req.params.id, function (err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error deleting task",
                    data: err.message
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }

            // Remove task from assigned user's pendingTasks
            if (task.assignedUser && task.assignedUser !== "") {
                User.findById(task.assignedUser, function (err, user) {
                    if (!err && user) {
                        var index = user.pendingTasks.indexOf(req.params.id);
                        if (index > -1) {
                            user.pendingTasks.splice(index, 1);
                            user.save(function (err) {
                                if (err) {
                                    return res.status(500).json({
                                        message: "Error updating user",
                                        data: err.message
                                    });
                                }
                                res.status(204).send();
                            });
                        } else {
                            res.status(204).send();
                        }
                    } else {
                        res.status(204).send();
                    }
                });
            } else {
                res.status(204).send();
            }
        });
    });

    return router;
};

