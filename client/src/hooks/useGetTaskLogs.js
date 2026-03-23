import { useState, useEffect } from 'react';
import { toastError } from '../utils/toastError.jsx';
import { tasksService } from '../feathers.js';

export function useGetTaskLogs(taskId) {
  const [logs, setLogs] = useState('');

  useEffect(() => {
    if (!taskId) return;

    tasksService
      .logs(taskId)
      .then((res) => setLogs(res.logs ?? ''))
      .catch((err) => toastError('Failed to load task logs', err));

    const onLog = (data) => {
      if (data.id !== taskId) return;
      setLogs((prev) => prev + (data.data ?? ''));
    };

    tasksService.on('log', onLog);
    return () => tasksService.off('log', onLog);
  }, [taskId]);

  return { logs };
}
