'use strict';

function projectEvents(events = []) {
  const projection = {
    schema: 'aecp.event-projection/v1',
    total: 0,
    latestAt: null,
    byType: {},
    runs: {},
    tasks: {},
    approvals: {}
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    projection.total += 1;
    if (event.at && (!projection.latestAt || event.at > projection.latestAt)) projection.latestAt = event.at;
    const type = String(event.type || 'unknown');
    projection.byType[type] = (projection.byType[type] || 0) + 1;

    if (event.runId) {
      const run = projection.runs[event.runId] ||= { eventCount: 0, lastEvent: null, lastAt: null };
      run.eventCount += 1;
      run.lastEvent = type;
      run.lastAt = event.at || run.lastAt;
    }
    if (event.taskId) {
      const task = projection.tasks[event.taskId] ||= { eventCount: 0, runId: event.runId || null, lastEvent: null, lastAt: null };
      task.eventCount += 1;
      task.runId ||= event.runId || null;
      task.lastEvent = type;
      task.lastAt = event.at || task.lastAt;
    }
    if (event.approvalId) {
      const approval = projection.approvals[event.approvalId] ||= { eventCount: 0, taskId: event.taskId || null, runId: event.runId || null, lastEvent: null, lastAt: null };
      approval.eventCount += 1;
      approval.lastEvent = type;
      approval.lastAt = event.at || approval.lastAt;
    }
  }
  return projection;
}

module.exports = { projectEvents };
