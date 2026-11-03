import { randomUUID } from 'node:crypto';
import { STUDY_PATH_JOB_TTL_MS } from '../config/studyPathConfig.js';

const jobs = new Map();

export function createStudyPathJob(ownerId) {
  const jobId = randomUUID();
  const job = {
    jobId,
    ownerId: ownerId || 'anonymous-user',
    status: 'queued',
    stage: 'Queued for processing',
    done: 0,
    total: 0,
    createdAt: Date.now(),
    topicId: null,
    studyPath: null,
    message: null
  };
  jobs.set(jobId, job);
  const expiry = setTimeout(() => jobs.delete(jobId), STUDY_PATH_JOB_TTL_MS);
  expiry.unref?.();
  return job;
}

export function updateStudyPathJob(jobId, values) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, values, { updatedAt: Date.now() });
  return job;
}

export function getStudyPathJob(jobId) {
  return jobs.get(jobId) || null;
}

export function serializeStudyPathJob(job) {
  if (!job) return null;
  const { jobId, status, stage, done, total, topicId, studyPath, message } = job;
  return { jobId, status, stage, done, total, ...(topicId ? { topicId } : {}), ...(studyPath ? { studyPath } : {}), ...(message ? { message } : {}) };
}
