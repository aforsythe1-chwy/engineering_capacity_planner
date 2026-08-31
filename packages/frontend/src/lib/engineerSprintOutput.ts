import type { EngineerSprintOutput } from '@ecp/shared';

const round = (value: number) => Math.round(value * 10) / 10;
export function engineerSprintOutputModel(engineer: EngineerSprintOutput, partial: boolean) {
  const output = engineer.donePoints + engineer.inReviewPoints;
  const ratio = !partial && engineer.adjustedCapacity !== null && engineer.adjustedCapacity > 0 ? output / engineer.adjustedCapacity : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const widths = [engineer.donePoints, engineer.inReviewPoints, engineer.inProgressPoints, engineer.toDoPoints].map((points, index, all) => ratio === null ? 0 : Math.min(Math.max(0, 100 - all.slice(0, index).reduce((sum, value) => sum + value / engineer.adjustedCapacity! * 100, 0)), points / engineer.adjustedCapacity! * 100));
  const [doneWidth = 0, reviewWidth = 0, inProgressWidth = 0, toDoWidth = 0] = widths;
  return { output: round(output), done: round(engineer.donePoints), review: round(engineer.inReviewPoints), inProgress: round(engineer.inProgressPoints), toDo: round(engineer.toDoPoints), capacity: engineer.adjustedCapacity === null ? null : round(engineer.adjustedCapacity), percent, doneWidth, reviewWidth, inProgressWidth, toDoWidth, doneReviewWidth: Math.min(100, doneWidth + reviewWidth), inProgressTotalWidth: Math.min(100, doneWidth + reviewWidth + inProgressWidth), totalScopeWidth: Math.min(100, doneWidth + reviewWidth + inProgressWidth + toDoWidth) };
}
