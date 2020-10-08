import { AppBaseDataEntityLikeStates, AppDataComplete } from '../../imex/sync/sync.model';
import { TagCopy } from '../../features/tag/tag.model';
import { ProjectCopy } from '../../features/project/project.model';
import { isDataRepairPossible } from './is-data-repair-possible.util';
import { TaskArchive, TaskCopy, TaskState } from '../../features/tasks/task.model';
import { unique } from '../../util/unique';

const ENTITY_STATE_KEYS: (keyof AppDataComplete)[] = ['task', 'taskArchive', 'taskRepeatCfg', 'tag', 'project', 'simpleCounter'];

export const dataRepair = (data: AppDataComplete): AppDataComplete => {
  if (!isDataRepairPossible(data)) {
    throw new Error('Data repair attempted but not possible');
  }

  // console.time('dataRepair');
  let dataOut: AppDataComplete = data;
  // let dataOut: AppDataComplete = dirtyDeepCopy(data);
  dataOut = _fixEntityStates(dataOut);
  dataOut = _removeMissingTasksFromListsOrRestoreFromArchive(dataOut);
  dataOut = _removeDuplicatesFromArchive(dataOut);
  dataOut = _addOrphanedTasksToProjectLists(dataOut);
  dataOut = _moveArchivedSubTasksToUnarchivedParents(dataOut);
  dataOut = _moveUnArchivedSubTasksToArchivedParents(dataOut);
  // console.timeEnd('dataRepair');
  return dataOut;
};

const _fixEntityStates = (data: AppDataComplete): AppDataComplete => {
  ENTITY_STATE_KEYS.forEach((key) => {
    data[key] = _resetEntityIdsFromObjects(data[key] as AppBaseDataEntityLikeStates) as any;
  });

  return data;
};

const _removeDuplicatesFromArchive = (data: AppDataComplete): AppDataComplete => {
  const taskIds = data.task.ids as string[];
  const archiveTaskIds = data.taskArchive.ids as string[];
  const duplicateIds = taskIds.filter((id) => archiveTaskIds.includes(id));

  if (duplicateIds.length) {
    data.taskArchive.ids = archiveTaskIds.filter(id => !duplicateIds.includes(id));
    duplicateIds.forEach(id => {
      if (data.taskArchive.entities[id]) {
        delete data.taskArchive.entities[id];
      }
    });
    if (duplicateIds.length > 0) {
      console.log(duplicateIds.length + ' duplicates removed from archive.');
    }
  }
  return data;
};

const _moveArchivedSubTasksToUnarchivedParents = (data: AppDataComplete): AppDataComplete => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveState: TaskArchive = data.taskArchive;
  const taskArchiveIds = taskArchiveState.ids as string[];
  const orhphanedArchivedSubTasks: TaskCopy[] = taskArchiveIds
    .map((id: string) => taskArchiveState.entities[id] as TaskCopy)
    .filter((t: TaskCopy) => t.parentId && !taskArchiveIds.includes(t.parentId));

  orhphanedArchivedSubTasks.forEach((t: TaskCopy) => {
    // delete archived if duplicate
    if (taskState.ids.includes(t.id as string)) {
      taskArchiveState.ids = taskArchiveIds.filter(id => t.id !== id);
      delete taskArchiveState.entities[t.id];
    }
    // copy to today if parent exists
    else if (taskState.ids.includes(t.parentId as string)) {
      taskState.ids.push((t.id));
      taskState.entities[t.id] = t;
      const par: TaskCopy = taskState.entities[t.parentId as string] as TaskCopy;

      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from archive
      taskArchiveState.ids = taskArchiveIds.filter(id => t.id !== id);
      delete taskArchiveState.entities[t.id];
    }
    // make main if it doesn't
    else {
      // @ts-ignore
      t.parentId = null;
    }
  });

  return data;
};

const _moveUnArchivedSubTasksToArchivedParents = (data: AppDataComplete): AppDataComplete => {
  // to avoid ambiguity
  const taskState: TaskState = data.task;
  const taskArchiveState: TaskArchive = data.taskArchive;
  const taskArchiveIds = taskArchiveState.ids as string[];
  const orhphanedUnArchivedSubTasks: TaskCopy[] = taskState.ids
    .map((id: string) => taskState.entities[id] as TaskCopy)
    .filter((t: TaskCopy) => t.parentId && !taskState.ids.includes(t.parentId));

  orhphanedUnArchivedSubTasks.forEach((t: TaskCopy) => {
    // delete un-archived if duplicate
    if (taskArchiveIds.includes(t.id as string)) {
      taskState.ids = taskState.ids.filter(id => t.id !== id);
      delete taskState.entities[t.id];
    }
    // copy to archive if parent exists
    else if (taskArchiveIds.includes(t.parentId as string)) {
      taskArchiveIds.push((t.id));
      taskArchiveState.entities[t.id] = t;

      const par: TaskCopy = taskArchiveState.entities[t.parentId as string] as TaskCopy;
      par.subTaskIds = unique([...par.subTaskIds, t.id]);

      // and delete from today
      taskState.ids = taskState.ids.filter(id => t.id !== id);
      delete taskState.entities[t.id];
    }
    // make main if it doesn't
    else {
      // @ts-ignore
      t.parentId = null;
    }
  });

  return data;
};

const _removeMissingTasksFromListsOrRestoreFromArchive = (data: AppDataComplete): AppDataComplete => {
  const {task, project, tag, taskArchive} = data;
  const taskIds: string[] = task.ids;
  const taskArchiveIds: string[] = taskArchive.ids as string[];
  const taskIdsToRestoreFromArchive: string[] = [];

  project.ids.forEach((pId: string | number) => {
    const projectItem = project.entities[pId] as ProjectCopy;

    projectItem.taskIds = projectItem.taskIds.filter((id: string): boolean => {
      if (taskArchiveIds.includes(id)) {
        taskIdsToRestoreFromArchive.push(id);
        return true;
      }
      return taskIds.includes(id);
    });

    projectItem.backlogTaskIds = projectItem.backlogTaskIds.filter((id: string): boolean => {
      if (taskArchiveIds.includes(id)) {
        taskIdsToRestoreFromArchive.push(id);
        return true;
      }
      return taskIds.includes(id);
    });
  });

  tag.ids.forEach((tId: string | number) => {
    const tagItem = tag.entities[tId] as TagCopy;
    tagItem.taskIds = tagItem.taskIds.filter(id => taskIds.includes(id));
  });

  taskIdsToRestoreFromArchive.forEach(id => {
    task.entities[id] = taskArchive.entities[id];
    delete taskArchive.entities[id];
  });
  task.ids = [...taskIds, ...taskIdsToRestoreFromArchive];
  taskArchive.ids = taskArchiveIds.filter(id => !taskIdsToRestoreFromArchive.includes(id));

  if (taskIdsToRestoreFromArchive.length > 0) {
    console.log(taskIdsToRestoreFromArchive.length + ' missing tasks restored from archive.');
  }
  return data;
};

const _resetEntityIdsFromObjects = <T>(data: AppBaseDataEntityLikeStates): AppBaseDataEntityLikeStates => {
  return {
    ...data,
    ids: Object.keys(data.entities)
  };
};

const _addOrphanedTasksToProjectLists = (data: AppDataComplete): AppDataComplete => {
  const {task, project} = data;
  let allTaskIdsOnProjectLists: string[] = [];

  project.ids.forEach((pId: string | number) => {
    const projectItem = project.entities[pId] as ProjectCopy;
    allTaskIdsOnProjectLists = allTaskIdsOnProjectLists.concat(projectItem.taskIds, projectItem.backlogTaskIds);
  });
  const orphanedTaskIds: string[] = task.ids.filter(tid => {
    const taskItem = task.entities[tid];
    if (!taskItem) {
      throw new Error('Missing task');
    }
    return !taskItem.parentId && !allTaskIdsOnProjectLists.includes(tid) && taskItem.projectId;
  });

  orphanedTaskIds.forEach(tid => {
    const taskItem = task.entities[tid];
    if (!taskItem) {
      throw new Error('Missing task');
    }
    project.entities[taskItem.projectId as string]?.taskIds.push(tid);
  });

  if (orphanedTaskIds.length > 0) {
    console.log(orphanedTaskIds.length + ' orphaned tasks found & restored.');
  }

  return data;
};

