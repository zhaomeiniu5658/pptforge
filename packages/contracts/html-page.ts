export interface Diagnostic {severity:'warning'|'error';message:string;source?:'pptx';score?:number}
export interface HtmlPageDocument {
 schemaVersion:1;
 html:string;
 css:string;
 assets:Array<{id?:string;uri?:string}>;
 interactions:Array<{type:'toggle'|'tabs'|'modal'|'anchor';trigger:string;target:string}>;
 layoutMode:'flow'|'fixed';
 sourceSize:{width:number;height:number}|null;
 editableNodes:Array<{id:string;tag:string;editable:boolean}>;
 sourceReferences:Array<Record<string,unknown>>;
 diagnostics:Diagnostic[];
}
export interface PageSaveRequest {title:string;document:HtmlPageDocument;base_revision_id:string}
export interface AiRequest {project_id:string;booklet_id:string;page_id?:string;base_revision_id?:string;prompt:string;asset_id?:string;parent_job_id?:string}
export type JobStatus='queued'|'running'|'succeeded'|'failed'|'cancelled';
