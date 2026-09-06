export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agent_versions: {
        Row: {
          agent_id: string;
          configuration: Json;
          published_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          agent_id: string;
          configuration: Json;
          published_at?: string;
          version: number;
          workspace_id: string;
        };
        Update: {
          agent_id?: string;
          configuration?: Json;
          published_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_versions_workspace_id_agent_id_fkey";
            columns: ["workspace_id", "agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      agents: {
        Row: {
          created_at: string;
          description: string;
          goal: string;
          id: string;
          knowledge: string;
          language: string;
          name: string;
          reply_groups: string[];
          reply_policy: string;
          status: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string;
          goal?: string;
          id?: string;
          knowledge?: string;
          language?: string;
          name: string;
          reply_groups?: string[];
          reply_policy?: string;
          status?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          goal?: string;
          id?: string;
          knowledge?: string;
          language?: string;
          name?: string;
          reply_groups?: string[];
          reply_policy?: string;
          status?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_config_publications: {
        Row: {
          actor: string | null;
          created_at: string;
          id: number;
          version_id: number;
        };
        Insert: {
          actor?: string | null;
          created_at?: string;
          id?: never;
          version_id: number;
        };
        Update: {
          actor?: string | null;
          created_at?: string;
          id?: never;
          version_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ai_config_publications_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "ai_config_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_config_release: {
        Row: {
          revision: number;
          singleton: boolean;
          version_id: number;
        };
        Insert: {
          revision?: number;
          singleton?: boolean;
          version_id: number;
        };
        Update: {
          revision?: number;
          singleton?: boolean;
          version_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ai_config_release_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "ai_config_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_config_versions: {
        Row: {
          configuration: Json;
          created_at: string;
          created_by: string | null;
          id: number;
        };
        Insert: {
          configuration: Json;
          created_at?: string;
          created_by?: string | null;
          id?: never;
        };
        Update: {
          configuration?: Json;
          created_at?: string;
          created_by?: string | null;
          id?: never;
        };
        Relationships: [];
      };
      ai_runs: {
        Row: {
          agent_id: string | null;
          agent_version: number | null;
          catalog_revision: number;
          completed_at: string | null;
          configuration_version: number;
          conversation_id: string | null;
          created_at: string;
          error_code: string | null;
          id: string;
          model: string;
          scenario: string;
          status: string;
          workspace_id: string;
        };
        Insert: {
          agent_id?: string | null;
          agent_version?: number | null;
          catalog_revision: number;
          completed_at?: string | null;
          configuration_version: number;
          conversation_id?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          model: string;
          scenario: string;
          status?: string;
          workspace_id: string;
        };
        Update: {
          agent_id?: string | null;
          agent_version?: number | null;
          catalog_revision?: number;
          completed_at?: string | null;
          configuration_version?: number;
          conversation_id?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          model?: string;
          scenario?: string;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_runs_configuration_version_fkey";
            columns: ["configuration_version"];
            isOneToOne: false;
            referencedRelation: "ai_config_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_runs_workspace_id_conversation_id_fkey";
            columns: ["workspace_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "ai_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      connections: {
        Row: {
          created_at: string;
          last_event_at: string | null;
          revision: number;
          status: string;
          webhook_status: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          last_event_at?: string | null;
          revision?: number;
          status?: string;
          webhook_status?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          last_event_at?: string | null;
          revision?: number;
          status?: string;
          webhook_status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          archived: boolean;
          campaign: string;
          classified_revision: number | null;
          contact_company: string;
          contact_name: string;
          contact_position: string;
          contact_stopped: boolean;
          created_at: string;
          evidence_message_id: string | null;
          evidence_quote: string;
          id: string;
          inbound_revision: number;
          label_assignment_revision: number;
          label_id: string | null;
          label_source: string | null;
          label_state: string;
          labels: string[];
          last_message_at: string | null;
          no_reply_reason: string;
          notes: string;
          notes_revision: number;
          provider_conversation_id: string;
          reply_agent_id: string | null;
          reply_agent_version: number | null;
          reply_catalog_revision: number | null;
          reply_config_version: number | null;
          reply_decision_revision: number | null;
          sender_id: number;
          sender_name: string;
          workspace_id: string;
        };
        Insert: {
          archived?: boolean;
          campaign?: string;
          classified_revision?: number | null;
          contact_company?: string;
          contact_name: string;
          contact_position?: string;
          contact_stopped?: boolean;
          created_at?: string;
          evidence_message_id?: string | null;
          evidence_quote?: string;
          id?: string;
          inbound_revision?: number;
          label_assignment_revision?: number;
          label_id?: string | null;
          label_source?: string | null;
          label_state?: string;
          labels?: string[];
          last_message_at?: string | null;
          no_reply_reason?: string;
          notes?: string;
          notes_revision?: number;
          provider_conversation_id: string;
          reply_agent_id?: string | null;
          reply_agent_version?: number | null;
          reply_catalog_revision?: number | null;
          reply_config_version?: number | null;
          reply_decision_revision?: number | null;
          sender_id: number;
          sender_name: string;
          workspace_id: string;
        };
        Update: {
          archived?: boolean;
          campaign?: string;
          classified_revision?: number | null;
          contact_company?: string;
          contact_name?: string;
          contact_position?: string;
          contact_stopped?: boolean;
          created_at?: string;
          evidence_message_id?: string | null;
          evidence_quote?: string;
          id?: string;
          inbound_revision?: number;
          label_assignment_revision?: number;
          label_id?: string | null;
          label_source?: string | null;
          label_state?: string;
          labels?: string[];
          last_message_at?: string | null;
          no_reply_reason?: string;
          notes?: string;
          notes_revision?: number;
          provider_conversation_id?: string;
          reply_agent_id?: string | null;
          reply_agent_version?: number | null;
          reply_catalog_revision?: number | null;
          reply_config_version?: number | null;
          reply_decision_revision?: number | null;
          sender_id?: number;
          sender_name?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_label_fk";
            columns: ["workspace_id", "label_id"];
            isOneToOne: false;
            referencedRelation: "workspace_labels";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_generations: {
        Row: {
          agent_id: string;
          agent_version: number;
          approved_answer: string;
          conversation_id: string;
          created_at: string;
          error_code: string | null;
          expected_draft_id: string | null;
          expected_draft_revision: number | null;
          id: string;
          instructions: string;
          result_draft_id: string | null;
          source_revision: number;
          status: string;
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          agent_id: string;
          agent_version: number;
          approved_answer?: string;
          conversation_id: string;
          created_at?: string;
          error_code?: string | null;
          expected_draft_id?: string | null;
          expected_draft_revision?: number | null;
          id: string;
          instructions?: string;
          result_draft_id?: string | null;
          source_revision: number;
          status?: string;
          updated_at?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          agent_id?: string;
          agent_version?: number;
          approved_answer?: string;
          conversation_id?: string;
          created_at?: string;
          error_code?: string | null;
          expected_draft_id?: string | null;
          expected_draft_revision?: number | null;
          id?: string;
          instructions?: string;
          result_draft_id?: string | null;
          source_revision?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "draft_generations_workspace_id_agent_id_agent_version_fkey";
            columns: ["workspace_id", "agent_id", "agent_version"];
            isOneToOne: false;
            referencedRelation: "agent_versions";
            referencedColumns: ["workspace_id", "agent_id", "version"];
          },
          {
            foreignKeyName: "draft_generations_workspace_id_conversation_id_fkey";
            columns: ["workspace_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "draft_generations_workspace_id_expected_draft_id_fkey";
            columns: ["workspace_id", "expected_draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "draft_generations_workspace_id_result_draft_id_fkey";
            columns: ["workspace_id", "result_draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      drafts: {
        Row: {
          agent_id: string;
          agent_version: number;
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          missing_knowledge: string | null;
          revision: number;
          snoozed_until: string | null;
          source_revision: number;
          status: string;
          workspace_id: string;
        };
        Insert: {
          agent_id: string;
          agent_version: number;
          body?: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          missing_knowledge?: string | null;
          revision?: number;
          snoozed_until?: string | null;
          source_revision: number;
          status: string;
          workspace_id: string;
        };
        Update: {
          agent_id?: string;
          agent_version?: number;
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          missing_knowledge?: string | null;
          revision?: number;
          snoozed_until?: string | null;
          source_revision?: number;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drafts_workspace_id_agent_id_fkey";
            columns: ["workspace_id", "agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "drafts_workspace_id_conversation_id_fkey";
            columns: ["workspace_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      import_runs: {
        Row: {
          classified: number;
          created_at: string;
          days: number;
          error_code: string | null;
          id: string;
          imported: number;
          inspected: number;
          provider_offset: number;
          scan_finished: boolean;
          status: string;
          updated_at: string;
          window_end: string;
          window_start: string;
          workspace_id: string;
        };
        Insert: {
          classified?: number;
          created_at?: string;
          days: number;
          error_code?: string | null;
          id?: string;
          imported?: number;
          inspected?: number;
          provider_offset?: number;
          scan_finished?: boolean;
          status?: string;
          updated_at?: string;
          window_end?: string;
          window_start: string;
          workspace_id: string;
        };
        Update: {
          classified?: number;
          created_at?: string;
          days?: number;
          error_code?: string | null;
          id?: string;
          imported?: number;
          inspected?: number;
          provider_offset?: number;
          scan_finished?: boolean;
          status?: string;
          updated_at?: string;
          window_end?: string;
          window_start?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          direction: string;
          id: string;
          ingestion_key: string;
          occurred_at: string;
          source: string;
          workspace_id: string;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          direction: string;
          id?: string;
          ingestion_key: string;
          occurred_at: string;
          source: string;
          workspace_id: string;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          direction?: string;
          id?: string;
          ingestion_key?: string;
          occurred_at?: string;
          source?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_workspace_id_conversation_id_fkey";
            columns: ["workspace_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      send_operations: {
        Row: {
          conversation_id: string;
          created_at: string;
          id: string;
          message_id: string | null;
          reason: string | null;
          request: Json;
          source_revision: number;
          status: string;
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          id: string;
          message_id?: string | null;
          reason?: string | null;
          request: Json;
          source_revision: number;
          status: string;
          updated_at?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          id?: string;
          message_id?: string | null;
          reason?: string | null;
          request?: Json;
          source_revision?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "send_operations_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "send_operations_workspace_id_conversation_id_fkey";
            columns: ["workspace_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      senders: {
        Row: {
          auth_valid: boolean;
          name: string;
          provider_id: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          auth_valid: boolean;
          name: string;
          provider_id: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          auth_valid?: boolean;
          name?: string;
          provider_id?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "senders_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_labels: {
        Row: {
          archived: boolean;
          color: string;
          enabled: boolean;
          id: string;
          instruction: string;
          intent_group: string;
          name: string;
          revision: number;
          system_key: string | null;
          workspace_id: string;
        };
        Insert: {
          archived?: boolean;
          color: string;
          enabled?: boolean;
          id?: string;
          instruction?: string;
          intent_group: string;
          name: string;
          revision?: number;
          system_key?: string | null;
          workspace_id: string;
        };
        Update: {
          archived?: boolean;
          color?: string;
          enabled?: boolean;
          id?: string;
          instruction?: string;
          intent_group?: string;
          name?: string;
          revision?: number;
          system_key?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_labels_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          default_agent_id: string | null;
          id: string;
          label_revision: number;
          name: string;
          timezone: string;
        };
        Insert: {
          created_at?: string;
          default_agent_id?: string | null;
          id?: string;
          label_revision?: number;
          name: string;
          timezone?: string;
        };
        Update: {
          created_at?: string;
          default_agent_id?: string | null;
          id?: string;
          label_revision?: number;
          name?: string;
          timezone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_default_agent_fk";
            columns: ["id", "default_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_workspace_invite: { Args: { p_hash: string }; Returns: string };
      act_on_draft: {
        Args: {
          p_action: string;
          p_body?: string;
          p_id: string;
          p_remember?: boolean;
          p_revision: number;
          p_until?: string;
          p_workspace: string;
        };
        Returns: number;
      };
      agent_activity: {
        Args: { p_workspace: string };
        Returns: {
          agent_id: string;
          sent: number;
        }[];
      };
      assign_conversation_label: {
        Args: {
          p_assignment: number;
          p_conversation: string;
          p_label: string;
          p_revision: number;
          p_workspace: string;
        };
        Returns: undefined;
      };
      cancel_draft_generation: {
        Args: { p_id: string; p_workspace: string };
        Returns: undefined;
      };
      cancel_history_import: {
        Args: { p_run: string; p_workspace: string };
        Returns: undefined;
      };
      change_workspace_member: {
        Args: { p_role: string; p_user: string; p_workspace: string };
        Returns: undefined;
      };
      conversation_page: {
        Args: {
          p_before?: string;
          p_before_id?: string;
          p_label?: string;
          p_limit?: number;
          p_query?: string;
          p_workspace: string;
        };
        Returns: {
          archived: boolean;
          campaign: string;
          classified_revision: number | null;
          contact_company: string;
          contact_name: string;
          contact_position: string;
          contact_stopped: boolean;
          created_at: string;
          evidence_message_id: string | null;
          evidence_quote: string;
          id: string;
          inbound_revision: number;
          label_assignment_revision: number;
          label_id: string | null;
          label_source: string | null;
          label_state: string;
          labels: string[];
          last_message_at: string | null;
          no_reply_reason: string;
          notes: string;
          notes_revision: number;
          provider_conversation_id: string;
          reply_agent_id: string | null;
          reply_agent_version: number | null;
          reply_catalog_revision: number | null;
          reply_config_version: number | null;
          reply_decision_revision: number | null;
          sender_id: number;
          sender_name: string;
          workspace_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      conversation_previews: {
        Args: { p_ids: string[]; p_workspace: string };
        Returns: {
          body: string;
          conversation_id: string;
          created_at: string;
          direction: string;
          id: string;
          ingestion_key: string;
          occurred_at: string;
          source: string;
          workspace_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "messages";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_workspace: {
        Args: { p_name: string; p_timezone?: string };
        Returns: string;
      };
      create_workspace_invite: {
        Args: {
          p_email: string;
          p_hash: string;
          p_role: string;
          p_workspace: string;
        };
        Returns: string;
      };
      disconnect_workspace: {
        Args: { p_workspace: string };
        Returns: undefined;
      };
      draft_page: {
        Args: {
          p_before?: string;
          p_before_id?: string;
          p_label?: string;
          p_limit?: number;
          p_query?: string;
          p_status?: string;
          p_workspace: string;
        };
        Returns: {
          agent_id: string;
          agent_version: number;
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          missing_knowledge: string | null;
          revision: number;
          snoozed_until: string | null;
          source_revision: number;
          status: string;
          workspace_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "drafts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      is_platform_owner: { Args: never; Returns: boolean };
      list_workspace_invites: {
        Args: { p_workspace: string };
        Returns: {
          email: string;
          expires_at: string;
          id: string;
          role: string;
        }[];
      };
      list_workspace_members: {
        Args: { p_workspace: string };
        Returns: {
          email: string;
          name: string;
          role: string;
          user_id: string;
          workspace_id: string;
        }[];
      };
      publish_ai_configuration: {
        Args: { p_revision: number; p_version: number };
        Returns: undefined;
      };
      request_draft_generation: {
        Args: {
          p_answer?: string;
          p_conversation: string;
          p_draft?: string;
          p_id: string;
          p_instructions?: string;
          p_remember?: boolean;
          p_revision?: number;
          p_source_revision: number;
          p_workspace: string;
        };
        Returns: string;
      };
      request_send_check: {
        Args: { p_id: string; p_workspace: string };
        Returns: undefined;
      };
      reserve_agent_test: { Args: { p_workspace: string }; Returns: undefined };
      reserve_send: {
        Args: {
          p_body: string;
          p_connection_revision?: number;
          p_conversation: string;
          p_draft?: string;
          p_id: string;
          p_revision?: number;
          p_source_revision?: number;
          p_workspace: string;
        };
        Returns: Json;
      };
      resolve_unconfirmed_send: {
        Args: { p_id: string; p_workspace: string };
        Returns: undefined;
      };
      retry_classification: {
        Args: { p_conversation: string; p_workspace: string };
        Returns: undefined;
      };
      retry_history_import: {
        Args: { p_run: string; p_workspace: string };
        Returns: undefined;
      };
      revoke_workspace_invite: {
        Args: { p_id: string; p_workspace: string };
        Returns: undefined;
      };
      save_agent: {
        Args: {
          p_config: Json;
          p_id: string;
          p_revision: number;
          p_workspace: string;
        };
        Returns: number;
      };
      save_ai_configuration: {
        Args: { p_configuration: Json };
        Returns: number;
      };
      save_note: {
        Args: {
          p_id: string;
          p_notes: string;
          p_revision: number;
          p_workspace: string;
        };
        Returns: number;
      };
      save_workspace_label: {
        Args: {
          p_id: string;
          p_revision: number;
          p_value: Json;
          p_workspace: string;
        };
        Returns: string;
      };
      server_apply_classification: {
        Args: {
          p_agent: string;
          p_agent_version: number;
          p_connection_revision?: number;
          p_conversation: string;
          p_draft: string;
          p_generate: boolean;
          p_labels: string[];
          p_missing: string;
          p_revision: number;
          p_run?: string;
          p_workspace: string;
        };
        Returns: boolean;
      };
      server_apply_intent: {
        Args: {
          p_agent: string;
          p_agent_version: number;
          p_assignment: number;
          p_catalog: number;
          p_config: number;
          p_conversation: string;
          p_generate: boolean;
          p_result: Json;
          p_revision: number;
          p_run?: string;
          p_workspace: string;
        };
        Returns: boolean;
      };
      server_claim_job: { Args: never; Returns: Json };
      server_complete_generation: {
        Args: {
          p_body: string;
          p_id: string;
          p_missing: string;
          p_should_reply: boolean;
          p_workspace: string;
        };
        Returns: undefined;
      };
      server_complete_generation_v2: {
        Args: {
          p_assignment: number;
          p_body: string;
          p_catalog: number;
          p_config: number;
          p_id: string;
          p_missing: string;
          p_reason: string;
          p_should_reply: boolean;
          p_stopped: boolean;
          p_workspace: string;
        };
        Returns: undefined;
      };
      server_complete_send: {
        Args: {
          p_id: string;
          p_reason?: string;
          p_status: string;
          p_workspace: string;
        };
        Returns: undefined;
      };
      server_connect: {
        Args: {
          p_actor: string;
          p_ciphertext: string;
          p_fingerprint: string;
          p_senders: Json;
          p_webhook_hash: string;
          p_workspace: string;
        };
        Returns: undefined;
      };
      server_credentials: { Args: { p_workspace: string }; Returns: Json };
      server_enqueue: {
        Args: {
          p_key: string;
          p_kind: string;
          p_payload: Json;
          p_workspace: string;
        };
        Returns: undefined;
      };
      server_finish_job: {
        Args: { p_error?: string; p_id: string; p_lease: string };
        Returns: undefined;
      };
      server_import_page: {
        Args: {
          p_connection_revision: number;
          p_items: Json;
          p_offset: number;
          p_received: number;
          p_run: string;
          p_total: number;
        };
        Returns: undefined;
      };
      server_ingest_conversation: {
        Args: {
          p_connection_revision: number;
          p_data: Json;
          p_run?: string;
          p_workspace: string;
        };
        Returns: Json;
      };
      server_intent_backfill_status: {
        Args: never;
        Returns: {
          runs: number;
          status: string;
        }[];
      };
      server_refresh_senders: {
        Args: { p_revision: number; p_senders: Json; p_workspace: string };
        Returns: undefined;
      };
      set_default_agent: {
        Args: { p_agent: string; p_workspace: string };
        Returns: undefined;
      };
      start_history_import: {
        Args: { p_days: number; p_workspace: string };
        Returns: string;
      };
      update_draft: {
        Args: {
          p_body: string;
          p_id: string;
          p_revision: number;
          p_snoozed_until?: string;
          p_status: string;
          p_workspace: string;
        };
        Returns: number;
      };
      wake_due_drafts: { Args: { p_workspace: string }; Returns: number };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
