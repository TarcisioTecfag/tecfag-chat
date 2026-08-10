ALTER TABLE "internal_messages" DROP CONSTRAINT "internal_messages_operator_id_operators_id_fk";
--> statement-breakpoint
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;