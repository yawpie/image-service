/*
  Warnings:

  - A unique constraint covering the columns `[url]` on the table `image` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "image_url_key" ON "image"("url");
