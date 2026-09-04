-- P5 #3：法律文档表（2026-08-25，流程后缀 _c）
-- 服务条款(TERMS)/隐私政策(PRIVACY) 正文，按版本管理；content 为多语言 JSON。
-- 同一 docType 仅一条 is_active=true（应用层保证，DB 层加部分唯一索引兜底）。
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_doc_type_version_key" ON "legal_documents"("doc_type", "version");
CREATE INDEX "legal_documents_doc_type_is_active_idx" ON "legal_documents"("doc_type", "is_active");

-- 部分唯一索引：同一 docType 仅一条 is_active=true（DB 层兜底，防止应用层并发写入出错）
CREATE UNIQUE INDEX "legal_documents_doc_type_active_uniq" ON "legal_documents"("doc_type") WHERE "is_active" = true;
