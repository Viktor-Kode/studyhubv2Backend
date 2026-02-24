import axios from 'axios';
import { getEnv } from '../config/env.js';

const ALOC_BASE = 'https://questions.aloc.com.ng/api/v2';

/**
 * Tests the ALOC API connection
 */
export const testALOCConnection = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');

    if (!token) {

        return res.status(503).json({
            status: 'error',
            service: 'ALOC',
            message: 'ALOC_ACCESS_TOKEN not configured on server'
        });
    }

    try {
        const response = await axios.get(`${ALOC_BASE}/q/1`, {
            headers: { 'Accept': 'application/json', 'AccessToken': token },
            timeout: 5000
        });

        if (response.data && response.data.status === 200) {
            return res.status(200).json({
                status: 'success',
                service: 'ALOC',
                message: 'Connection to ALOC Questions API successful',
                api_status: response.data.status
            });
        } else {
            throw new Error(response.data?.message || 'Unexpected response from ALOC');
        }
    } catch (error) {
        return res.status(502).json({
            status: 'fail',
            service: 'ALOC',
            message: 'Failed to connect to ALOC API: ' + error.message
        });
    }
};

/**
 * Proxy for fetching questions from ALOC
 */
export const getQuestionsProxy = async (req, res) => {
    const token = getEnv('ALOC_ACCESS_TOKEN');
    const { subject, type, year, amount = 10 } = req.query;

    if (!token) {
        return res.status(503).json({
            error: "CBT service unavailable",
            message: "ALOC_ACCESS_TOKEN not configured on server"
        });
    }

    try {
        // Build the ALOC URL based on their API spec
        // Format: /m/${amount}?subject=${subject}&type=${type}&year=${year}
        let url = `${ALOC_BASE}/m/${amount}`;
        const params = new URLSearchParams();
        if (subject) params.append('subject', subject);
        if (type) params.append('type', type);
        if (year) params.append('year', year);

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        const response = await axios.get(url, {
            headers: { 'Accept': 'application/json', 'AccessToken': token }
        });

        return res.status(response.status).json(response.data);
    } catch (error) {
        console.error('ALOC Proxy Error:', error.message);
        return res.status(error.response?.status || 500).json({
            error: 'Failed to fetch questions from ALOC',
            details: error.response?.data || error.message
        });
    }
};
