-- 仅新增索引：按用户查询错题、科目、练习记录，以及按错题查复习计划
-- CreateIndex
CREATE INDEX "ErrorItem_userId_createdAt_idx" ON "ErrorItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorItem_subjectId_idx" ON "ErrorItem"("subjectId");

-- CreateIndex
CREATE INDEX "PracticeRecord_userId_createdAt_idx" ON "PracticeRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewSchedule_errorItemId_idx" ON "ReviewSchedule"("errorItemId");

-- CreateIndex
CREATE INDEX "Subject_userId_idx" ON "Subject"("userId");

