import { config } from './config.js';

export class APIHelper {
  private baseUrl: string;
  private headers: HeadersInit;

  constructor() {
    this.baseUrl = config.apiBaseUrl;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.apiToken && { Authorization: `Bearer ${config.apiToken}` }),
    };
  }

  async get(endpoint: string) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: this.headers,
    });
    return this.handleResponse(response);
  }

  async post(endpoint: string, body: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse(response);
  }

  async put(endpoint: string, body: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse(response);
  }

  async delete(endpoint: string) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    return this.handleResponse(response);
  }

  private async handleResponse(response: Response) {
    const data = await response.json().catch(() => null);
    return {
      status: response.status,
      data,
      ok: response.ok,
    };
  }
}
