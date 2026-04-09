package supervisor

import "context"

// FSRead reads a file via POST /fs/read.
func (c *Client) FSRead(ctx context.Context, req FSReadRequest) (*FSReadResponse, error) {
	var resp FSReadResponse
	if err := c.post(ctx, "/fs/read", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FSWrite writes a file via POST /fs/write.
func (c *Client) FSWrite(ctx context.Context, req FSWriteRequest) (*FSWriteResponse, error) {
	var resp FSWriteResponse
	if err := c.post(ctx, "/fs/write", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FSStat returns file metadata via POST /fs/stat.
func (c *Client) FSStat(ctx context.Context, req FSStatRequest) (*FSStatResponse, error) {
	var resp FSStatResponse
	if err := c.post(ctx, "/fs/stat", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FSReaddir lists directory contents via POST /fs/readdir.
func (c *Client) FSReaddir(ctx context.Context, req FSReaddirRequest) (*FSReaddirResponse, error) {
	var resp FSReaddirResponse
	if err := c.post(ctx, "/fs/readdir", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FSMkdir creates a directory via POST /fs/mkdir.
func (c *Client) FSMkdir(ctx context.Context, req FSMkdirRequest) error {
	return c.post(ctx, "/fs/mkdir", req, nil)
}

// FSExists checks if a path exists via POST /fs/exists.
func (c *Client) FSExists(ctx context.Context, req FSExistsRequest) (*FSExistsResponse, error) {
	var resp FSExistsResponse
	if err := c.post(ctx, "/fs/exists", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FSGrep searches file contents via POST /fs/grep.
func (c *Client) FSGrep(ctx context.Context, req FSGrepRequest) (*FSGrepResponse, error) {
	var resp FSGrepResponse
	if err := c.post(ctx, "/fs/grep", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
