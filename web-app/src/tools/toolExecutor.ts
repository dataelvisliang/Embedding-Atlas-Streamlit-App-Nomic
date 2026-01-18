import { Coordinator } from '@uwdata/mosaic-core';

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolResult {
    name: string;
    call_id: string;
    result: any;
    error?: string;
}

/**
 * ToolExecutor runs tools in the browser using DuckDB-WASM via Mosaic Coordinator.
 * This enables the LLM to query the full reviews dataset directly.
 */
export class ToolExecutor {
    private coordinator: Coordinator;

    constructor(coordinator: Coordinator) {
        this.coordinator = coordinator;
    }

    /**
     * Execute a tool call and return the result
     */
    async execute(toolCall: ToolCall): Promise<ToolResult> {
        const { name, arguments: argsJson } = toolCall.function;

        let args: any;
        try {
            args = JSON.parse(argsJson);
        } catch (e) {
            return {
                name,
                call_id: toolCall.id,
                result: null,
                error: `Failed to parse arguments: ${argsJson}`
            };
        }

        try {
            switch (name) {
                case 'sql_query':
                    return await this.sqlQuery(toolCall.id, args.query);

                case 'text_search':
                    return await this.textSearch(toolCall.id, args.query, args.limit);

                case 'flexible_search':
                    return await this.flexibleSearch(toolCall.id, args.terms, args.mode, args.limit, args.regex);

                case 'get_stats':
                    return await this.getStats(toolCall.id, args.include_rating_distribution);

                case 'get_sample':
                    return await this.getSample(toolCall.id, args.count, args.rating_filter);

                default:
                    return {
                        name,
                        call_id: toolCall.id,
                        result: null,
                        error: `Unknown tool: ${name}`
                    };
            }
        } catch (error) {
            return {
                name,
                call_id: toolCall.id,
                result: null,
                error: error instanceof Error ? error.message : 'Tool execution failed'
            };
        }
    }

    /**
     * Execute a SQL SELECT query on the reviews table
     * Security: Only allows SELECT queries
     */
    private async sqlQuery(callId: string, query: string): Promise<ToolResult> {
        // Security: Only allow SELECT queries
        const normalized = query.trim().toUpperCase();
        if (!normalized.startsWith('SELECT')) {
            return {
                name: 'sql_query',
                call_id: callId,
                result: null,
                error: 'Only SELECT queries are allowed for security reasons'
            };
        }

        // Block dangerous keywords
        const dangerousKeywords = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE'];
        for (const keyword of dangerousKeywords) {
            if (normalized.includes(keyword)) {
                return {
                    name: 'sql_query',
                    call_id: callId,
                    result: null,
                    error: `Query contains forbidden keyword: ${keyword}`
                };
            }
        }

        const result = await this.coordinator.query(query);
        const allRows = result.toArray();
        const rows = allRows.slice(0, 100); // Limit results to 100 rows

        return {
            name: 'sql_query',
            call_id: callId,
            result: {
                columns: rows.length > 0 ? Object.keys(rows[0]) : [],
                rows: rows,
                row_count: rows.length,
                total_matching: allRows.length,
                truncated: allRows.length > 100
            }
        };
    }

    /**
     * Search for reviews containing specific keywords
     */
    private async textSearch(
        callId: string,
        searchQuery: string,
        limit: number = 10
    ): Promise<ToolResult> {
        // Escape single quotes to prevent SQL injection
        const escapedQuery = searchQuery.replace(/'/g, "''");
        const safeLimit = Math.min(Math.max(1, limit || 10), 50);

        const sql = `
      SELECT __row_index__, Rating, description
      FROM reviews
      WHERE description ILIKE '%${escapedQuery}%'
      LIMIT ${safeLimit}
    `;

        const result = await this.coordinator.query(sql);
        const rows = result.toArray();

        // Get total count for context
        const countSql = `
      SELECT COUNT(*) as total
      FROM reviews  
      WHERE description ILIKE '%${escapedQuery}%'
    `;
        const countResult = await this.coordinator.query(countSql);
        const totalMatches = countResult.toArray()[0]?.total || 0;

        return {
            name: 'text_search',
            call_id: callId,
            result: {
                query: searchQuery,
                matches_returned: rows.length,
                total_matches: totalMatches,
                reviews: rows.map(r => ({
                    id: r.__row_index__,
                    rating: r.Rating,
                    excerpt: r.description?.length > 300
                        ? r.description.substring(0, 300) + '...'
                        : r.description
                }))
            }
        };
    }

    /**
     * Get overall statistics about the reviews dataset
     */
    private async getStats(
        callId: string,
        includeDistribution: boolean = true
    ): Promise<ToolResult> {
        // Get basic stats
        const statsResult = await this.coordinator.query(
            'SELECT COUNT(*) as total, AVG(Rating) as avg_rating, MIN(Rating) as min_rating, MAX(Rating) as max_rating FROM reviews'
        );
        const stats = statsResult.toArray()[0];

        let distribution = null;
        if (includeDistribution) {
            const distResult = await this.coordinator.query(
                'SELECT Rating, COUNT(*) as count FROM reviews GROUP BY Rating ORDER BY Rating'
            );
            distribution = distResult.toArray();
        }

        return {
            name: 'get_stats',
            call_id: callId,
            result: {
                total_reviews: Number(stats.total),
                average_rating: Number(stats.avg_rating).toFixed(2),
                min_rating: stats.min_rating,
                max_rating: stats.max_rating,
                rating_distribution: distribution
            }
        };
    }

    /**
     * Get a sample of reviews, optionally filtered by rating
     */
    private async getSample(
        callId: string,
        count: number = 5,
        ratingFilter?: number
    ): Promise<ToolResult> {
        const safeCount = Math.min(Math.max(1, count || 5), 20);

        let sql = 'SELECT __row_index__, Rating, description FROM reviews';
        if (ratingFilter && ratingFilter >= 1 && ratingFilter <= 5) {
            sql += ` WHERE Rating = ${Math.floor(ratingFilter)}`;
        }
        sql += ` ORDER BY RANDOM() LIMIT ${safeCount}`;

        const result = await this.coordinator.query(sql);
        const rows = result.toArray();

        return {
            name: 'get_sample',
            call_id: callId,
            result: {
                sample_size: rows.length,
                filter: ratingFilter ? `Rating = ${ratingFilter}` : 'none',
                reviews: rows.map(r => ({
                    id: r.__row_index__,
                    rating: r.Rating,
                    text: r.description
                }))
            }
        };
    }

    /**
     * Flexible multi-term search with AND/OR modes and optional regex support
     * Solves the problem of "breakfast Bali Villa" finding nothing because it's treated as one phrase
     */
    private async flexibleSearch(
        callId: string,
        terms: string[],
        mode: 'AND' | 'OR' = 'AND',
        limit: number = 15,
        regex: boolean = false
    ): Promise<ToolResult> {
        // Handle string input (in case LLM sends comma-separated string)
        let searchTerms: string[] = [];
        if (typeof terms === 'string') {
            // Split by comma, semicolon, or " AND " / " OR "
            searchTerms = (terms as string)
                .split(/[,;]|\s+AND\s+|\s+OR\s+/i)
                .map(t => t.trim())
                .filter(t => t.length > 0);
        } else if (Array.isArray(terms)) {
            searchTerms = terms.map(t => String(t).trim()).filter(t => t.length > 0);
        }

        if (searchTerms.length === 0) {
            return {
                name: 'flexible_search',
                call_id: callId,
                result: null,
                error: 'No search terms provided'
            };
        }

        const safeLimit = Math.min(Math.max(1, limit || 15), 50);

        // Build WHERE clause - use regex or ILIKE based on mode
        const conditions = searchTerms.map(term => {
            if (regex) {
                // Use regexp_matches for regex mode
                // Escape single quotes for SQL
                const escaped = term.replace(/'/g, "''");
                return `regexp_matches(description, '${escaped}', 'i')`;
            } else {
                // Use ILIKE for normal substring matching
                const escaped = term.replace(/'/g, "''");
                return `description ILIKE '%${escaped}%'`;
            }
        });

        const whereClause = conditions.join(mode === 'AND' ? ' AND ' : ' OR ');

        // Query with matching reviews
        const sql = `
            SELECT __row_index__, Rating, description
            FROM reviews
            WHERE ${whereClause}
            LIMIT ${safeLimit}
        `;

        let rows: any[] = [];
        let totalMatches = 0;

        try {
            const result = await this.coordinator.query(sql);
            rows = result.toArray();

            // Get total count
            const countSql = `
                SELECT COUNT(*) as total
                FROM reviews
                WHERE ${whereClause}
            `;
            const countResult = await this.coordinator.query(countSql);
            totalMatches = Number(countResult.toArray()[0]?.total || 0);
        } catch (error) {
            // If regex is invalid, return helpful error
            if (regex && error instanceof Error) {
                return {
                    name: 'flexible_search',
                    call_id: callId,
                    result: null,
                    error: `Invalid regex pattern: ${error.message}`
                };
            }
            throw error;
        }

        // Also get individual term counts for context
        const termCounts: { term: string; count: number }[] = [];
        for (const term of searchTerms) {
            try {
                let termCountSql: string;
                if (regex) {
                    const escaped = term.replace(/'/g, "''");
                    termCountSql = `SELECT COUNT(*) as cnt FROM reviews WHERE regexp_matches(description, '${escaped}', 'i')`;
                } else {
                    const escaped = term.replace(/'/g, "''");
                    termCountSql = `SELECT COUNT(*) as cnt FROM reviews WHERE description ILIKE '%${escaped}%'`;
                }
                const termCountResult = await this.coordinator.query(termCountSql);
                termCounts.push({
                    term,
                    count: Number(termCountResult.toArray()[0]?.cnt || 0)
                });
            } catch {
                termCounts.push({ term, count: -1 }); // -1 indicates error
            }
        }

        return {
            name: 'flexible_search',
            call_id: callId,
            result: {
                terms: searchTerms,
                mode: mode,
                regex: regex,
                total_matches: totalMatches,
                matches_returned: rows.length,
                term_breakdown: termCounts,
                reviews: rows.map(r => ({
                    id: r.__row_index__,
                    rating: r.Rating,
                    excerpt: r.description?.length > 300
                        ? r.description.substring(0, 300) + '...'
                        : r.description
                }))
            }
        };
    }
}

/**
 * Tool definitions for the LLM (OpenAI function calling format)
 */
export const TOOL_DEFINITIONS = [
    {
        type: "function" as const,
        function: {
            name: "sql_query",
            description: "Execute a SQL SELECT query on the hotel reviews table. The table 'reviews' has columns: __row_index__ (int), description (text - the review content), Rating (int 1-5), projection_x (float), projection_y (float), neighbors (json). Use this for aggregations, counts, filtering, and complex queries.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "SQL SELECT query to execute. Examples: 'SELECT Rating, COUNT(*) FROM reviews GROUP BY Rating', 'SELECT AVG(Rating) FROM reviews', 'SELECT COUNT(*) FROM reviews WHERE Rating >= 4'"
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "text_search",
            description: "Search for reviews containing specific keywords or phrases. Use this to find reviews mentioning topics like 'breakfast', 'pool', 'noise', 'staff', 'clean', etc.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Keyword or phrase to search for in review text"
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of results to return (default: 10, max: 50)"
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_stats",
            description: "Get overall statistics for the reviews dataset including total count, average rating, and rating distribution.",
            parameters: {
                type: "object",
                properties: {
                    include_rating_distribution: {
                        type: "boolean",
                        description: "Whether to include breakdown by star rating (1-5)"
                    }
                }
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_sample",
            description: "Get a random sample of reviews to understand the data. Useful for getting examples of reviews with specific ratings.",
            parameters: {
                type: "object",
                properties: {
                    count: {
                        type: "number",
                        description: "Number of sample reviews to retrieve (default: 5, max: 20)"
                    },
                    rating_filter: {
                        type: "number",
                        description: "Optional: only get reviews with this star rating (1-5)"
                    }
                }
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "flexible_search",
            description: "Search for reviews where MULTIPLE terms ALL appear in the SAME review. Default mode is AND - all terms must be present in each matching review. Example: terms=['breakfast', 'Bali Villa'] finds only reviews mentioning BOTH 'breakfast' AND 'Bali Villa' together. Returns individual term counts to explain data availability.",
            parameters: {
                type: "object",
                properties: {
                    terms: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of search terms that must ALL appear in matching reviews. Example: ['breakfast', 'Bali Villa']"
                    },
                    mode: {
                        type: "string",
                        enum: ["AND", "OR"],
                        description: "AND (default) = ALL terms must appear in the SAME review. OR = matches reviews with ANY term (use for synonyms only)."
                    },
                    limit: {
                        type: "number",
                        description: "Maximum results to return (default: 15, max: 50)"
                    },
                    regex: {
                        type: "boolean",
                        description: "If true, treat terms as regex patterns. Examples: 'break(fast|fst)' matches typos, 'Bali.*Villa' matches 'Bali Beach Villa'. Default: false"
                    }
                },
                required: ["terms"]
            }
        }
    }
];
