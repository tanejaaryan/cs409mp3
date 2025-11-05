var User = require('../models/user');
var Task = require('../models/task');
var mongoose = require('mongoose');

module.exports = function (router) {
    // Routes for /api/users
    var usersRoute = router.route('/users');

    // GET /api/users
    usersRoute.get(function (req, res) {
        try {
            // Parse query parameters
            var where = req.query.where ? JSON.parse(req.query.where) : {};
            var sort = req.query.sort ? JSON.parse(req.query.sort) : {};
            var select = req.query.select ? JSON.parse(req.query.select) : {};
            var skip = req.query.skip ? parseInt(req.query.skip) : 0;
            var limit = req.query.limit ? parseInt(req.query.limit) : 0; // 0 means no limit
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
            var query = User.find(where);
            
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
                query.exec(function (err, users) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting users",
                            data: err.message
                        });
                    }
                    res.status(200).json({
                        message: "OK",
                        data: users.length
                    });
                });
            } else {
                query.exec(function (err, users) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error retrieving users",
                            data: err.message
                        });
                    }
                    // If querying by simple _id (not $in or other operators) and no results found, return 404
                    if (users.length === 0 && where._id && typeof where._id === 'string') {
                        return res.status(404).json({
                            message: "User not found",
                            data: {}
                        });
                    }
                    res.status(200).json({
                        message: "OK",
                        data: users
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

    // POST /api/users
    usersRoute.post(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Bad request - Name and email are required",
                data: {}
            });
        }

        var pendingTasks = req.body.pendingTasks || [];
        
        // Remove duplicates from pendingTasks
        pendingTasks = pendingTasks.filter(function (taskId, index, self) {
            return self.indexOf(taskId) === index;
        });

        // Validate that tasks exist if pendingTasks provided
        if (pendingTasks.length > 0) {
            Task.find({ _id: { $in: pendingTasks } }, function (err, tasks) {
                if (err) {
                    return res.status(500).json({
                        message: "Error validating tasks",
                        data: err.message
                    });
                }
                if (tasks.length !== pendingTasks.length) {
                    return res.status(404).json({
                        message: "One or more tasks not found",
                        data: {}
                    });
                }

                // Filter out completed tasks from pendingTasks - they should not be pending
                var completedTaskIds = tasks.filter(function (task) {
                    return task.completed === true;
                }).map(function (task) {
                    return task._id.toString();
                });

                if (completedTaskIds.length > 0) {
                    // Remove completed tasks from pendingTasks
                    pendingTasks = pendingTasks.filter(function (taskId) {
                        return completedTaskIds.indexOf(taskId) === -1;
                    });
                }

                // Allow reassigning tasks from other users - the two-way reference logic will handle it
                createUserAndUpdateTasks();
            });
        } else {
            createUserAndUpdateTasks();
        }

        function createUserAndUpdateTasks() {
            var user = new User();
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = pendingTasks;

            user.save(function (err, savedUser) {
                if (err) {
                    if (err.code === 11000) {
                        return res.status(400).json({
                            message: "Bad request - Email already exists",
                            data: {}
                        });
                    }
                    return res.status(500).json({
                        message: "Error creating user",
                        data: err.message
                    });
                }

                // Update two-way reference for tasks
                if (pendingTasks.length > 0) {
                    // Remove tasks from other users (if any were assigned)
                    User.updateMany(
                        { _id: { $ne: savedUser._id } },
                        { $pull: { pendingTasks: { $in: pendingTasks } } },
                        function (err) {
                            if (err) {
                                return res.status(500).json({
                                    message: "Error updating other users",
                                    data: err.message
                                });
                            }
                            
                            // Assign tasks to the new user
                            Task.updateMany(
                                { _id: { $in: pendingTasks } },
                                { $set: { assignedUser: savedUser._id.toString(), assignedUserName: savedUser.name } },
                                function (err) {
                                    if (err) {
                                        return res.status(500).json({
                                            message: "Error updating tasks",
                                            data: err.message
                                        });
                                    }
                                    res.status(201).json({
                                        message: "User created",
                                        data: savedUser
                                    });
                                }
                            );
                        }
                    );
                } else {
                    res.status(201).json({
                        message: "User created",
                        data: savedUser
                    });
                }
            });
        }
    });

    // Routes for /api/users/:id
    var userRoute = router.route('/users/:id');

    // GET /api/users/:id
    userRoute.get(function (req, res) {
        try {
            var select = req.query.select ? JSON.parse(req.query.select) : {};
            
            // Validate ObjectId format
            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }

            var query = User.findById(req.params.id);
            
            if (Object.keys(select).length > 0) {
                query = query.select(select);
            }

            query.exec(function (err, user) {
                if (err) {
                    return res.status(500).json({
                        message: "Error retrieving user",
                        data: err.message
                    });
                }
                if (!user) {
                    return res.status(404).json({
                        message: "User not found",
                        data: {}
                    });
                }
                res.status(200).json({
                    message: "OK",
                    data: user
                });
            });
        } catch (err) {
            return res.status(400).json({
                message: "Bad request - Invalid query parameters",
                data: err.message
            });
        }
    });

    // PUT /api/users/:id
    userRoute.put(function (req, res) {
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({
                message: "User not found",
                data: {}
            });
        }

        // Validate required fields
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Bad request - Name and email are required",
                data: {}
            });
        }

        User.findById(req.params.id, function (err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error finding user",
                    data: err.message
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }

            // Store old pending tasks
            var oldPendingTasks = user.pendingTasks || [];
            var newPendingTasks = req.body.pendingTasks || [];
            
            // Remove duplicates from newPendingTasks
            newPendingTasks = newPendingTasks.filter(function (taskId, index, self) {
                return self.indexOf(taskId) === index;
            });

            // Check if email is being changed and if new email already exists
            if (req.body.email !== user.email) {
                User.findOne({ email: req.body.email }, function (err, existingUser) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error checking email",
                            data: err.message
                        });
                    }
                    if (existingUser) {
                        return res.status(400).json({
                            message: "Bad request - Email already exists",
                            data: {}
                        });
                    }
                    updateUser();
                });
            } else {
                updateUser();
            }

            function updateUser() {
                // Maintain two-way reference
                // Tasks to unassign: oldPendingTasks - newPendingTasks
                var tasksToUnassign = oldPendingTasks.filter(function (taskId) {
                    return newPendingTasks.indexOf(taskId) === -1;
                });

                // Tasks to assign: newPendingTasks - oldPendingTasks
                var tasksToAssign = newPendingTasks.filter(function (taskId) {
                    return oldPendingTasks.indexOf(taskId) === -1;
                });

                // Validate that new tasks exist BEFORE saving user
                if (tasksToAssign.length > 0) {
                    Task.find({ _id: { $in: tasksToAssign } }, function (err, tasks) {
                        if (err) {
                            return res.status(500).json({
                                message: "Error validating tasks",
                                data: err.message
                            });
                        }
                        if (tasks.length !== tasksToAssign.length) {
                            return res.status(404).json({
                                message: "One or more tasks not found",
                                data: {}
                            });
                        }

                        // Filter out completed tasks from pendingTasks - they should not be pending
                        var completedTaskIds = tasks.filter(function (task) {
                            return task.completed === true;
                        }).map(function (task) {
                            return task._id.toString();
                        });

                        if (completedTaskIds.length > 0) {
                            // Remove completed tasks from newPendingTasks
                            newPendingTasks = newPendingTasks.filter(function (taskId) {
                                return completedTaskIds.indexOf(taskId) === -1;
                            });
                            // Also remove completed tasks from tasksToAssign
                            tasksToAssign = tasksToAssign.filter(function (taskId) {
                                return completedTaskIds.indexOf(taskId) === -1;
                            });
                        }

                        // Allow reassigning tasks from other users - the two-way reference logic will handle it
                        saveUserAndUpdateReferences();
                    });
                } else {
                    saveUserAndUpdateReferences();
                }

                function saveUserAndUpdateReferences() {
                    // Update user fields
                    user.name = req.body.name;
                    user.email = req.body.email;
                    user.pendingTasks = newPendingTasks;
                    // dateCreated should not be updated

                    user.save(function (err, updatedUser) {
                        if (err) {
                            if (err.code === 11000) {
                                return res.status(400).json({
                                    message: "Bad request - Email already exists",
                                    data: {}
                                });
                            }
                            return res.status(500).json({
                                message: "Error updating user",
                                data: err.message
                            });
                        }

                        // Unassign tasks that were removed
                        if (tasksToUnassign.length > 0) {
                            Task.updateMany(
                                { _id: { $in: tasksToUnassign } },
                                { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                                function (err) {
                                    if (err) {
                                        return res.status(500).json({
                                            message: "Error updating tasks",
                                            data: err.message
                                        });
                                    }
                                    assignNewTasks();
                                }
                            );
                        } else {
                            assignNewTasks();
                        }

                        function assignNewTasks() {
                            // Remove tasks from other users that are being assigned to this user
                            if (tasksToAssign.length > 0) {
                                User.updateMany(
                                    { _id: { $ne: req.params.id } },
                                    { $pull: { pendingTasks: { $in: tasksToAssign } } },
                                    function (err) {
                                        if (err) {
                                            return res.status(500).json({
                                                message: "Error updating other users",
                                                data: err.message
                                            });
                                        }
                                        assignTasksToUser();
                                    }
                                );
                            } else {
                                res.status(200).json({
                                    message: "User updated",
                                    data: updatedUser
                                });
                            }

                            function assignTasksToUser() {
                                // Assign new tasks to this user
                                Task.updateMany(
                                    { _id: { $in: tasksToAssign } },
                                    { $set: { assignedUser: req.params.id, assignedUserName: user.name } },
                                    function (err) {
                                        if (err) {
                                            return res.status(500).json({
                                                message: "Error updating tasks",
                                                data: err.message
                                            });
                                        }
                                        res.status(200).json({
                                            message: "User updated",
                                            data: updatedUser
                                        });
                                    }
                                );
                            }
                        }
                    });
                }
            }
        });
    });

    // DELETE /api/users/:id
    userRoute.delete(function (req, res) {
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({
                message: "User not found",
                data: {}
            });
        }

        User.findByIdAndRemove(req.params.id, function (err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error deleting user",
                    data: err.message
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }

            // Unassign all tasks that were assigned to this user
            Task.updateMany(
                { assignedUser: req.params.id },
                { $set: { assignedUser: "", assignedUserName: "unassigned" } },
                function (err) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error updating tasks",
                            data: err.message
                        });
                    }
                    res.status(204).send();
                }
            );
        });
    });

    return router;
};

