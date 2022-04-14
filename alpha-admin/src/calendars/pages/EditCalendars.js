import React from "react";
import { Title, useAuthState, Loading } from "react-admin";
import {
  Card,
  Typography,
  Container,
  Divider,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Grid,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";

// JSON 형식으로 받을 캘린더들(더미)
let calendars = [
  {
    _id: "61d6cf33bffd707ad9702853",
    name: "dummy calendar1",
    description: "description1",
    creator: "Captain1",
    member: "Captain1",
    timestamps: "2022-01-05 13:00",
  },
  {
    _id: "61d6cf33bffd707ad9702854",
    name: "dummy calendar2",
    description: "description222222",
    creator: "Captain2",
    member: "Captain1",
    timestamps: "2022-01-06 13:00",
  },
];

const isCreator = (calendar) => {
  return calendar.creator === calendar.member;
};

const EditCalendars = () => {
  const { isLoading, authenticated } = useAuthState();

  // 탈퇴 -> 탈퇴 완료시 캘린더 삭제된 결과 표시 필요
  const leaveHanlder = (event) => {
    alert("in leaveHandler");
    console.log(event.target.value);
  };
  // 임명 -> 임명 완료 시, 탈퇴버튼 활성화 표시 필요
  const changeOwnerHandler = (event) => {
    alert("in changeOwnerHanlder");
    console.log(event);
  };
  // 삭제 -> 삭제완료시 캘린더 삭제된 결과 표시 필요
  const deleteHandler = (event) => {
    alert("in deleteHanlder");
    console.log(event.target.value);
  };

  if (isLoading) {
    return <Loading />;
  }
  if (authenticated) {
    return (
      <React.Fragment>
        <Card sx={{ height: "100%" }}>
          <Container component="main" maxWidth="md">
            <Typography variant="h5" margin={1}>
              Edit calendars
            </Typography>
            <Grid
              sx={{
                border: 1,
                borderColor: "grey.200",
                borderRadius: "10px",
                p: 1,
              }}>
              <List>
                {calendars.map((calendar, index) => (
                  <React.Fragment key={calendar._id}>
                    <ListItem>
                      <ListItemAvatar>
                        <Avatar>
                          {/* 캘린더 아이콘 들어갈 자리 */}
                          <FolderIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={calendar.name}
                        secondary={calendar.description}
                      />
                      {/* 캘린더 팀원, 팀장인지에 따라 버튼을 달리 표시 */}
                      {!isCreator(calendar) && (
                        <Button
                          onClick={leaveHanlder}
                          value={calendar._id}
                          variant="contained"
                          sx={{ width: 100, fontSize: 12 }}>
                          leave
                        </Button>
                      )}
                      {isCreator(calendar) && (
                        <React.Fragment>
                          <Button
                            onClick={changeOwnerHandler}
                            value={calendar._id}
                            variant="outlined"
                            sx={{ mr: 1, width: 100, fontSize: 12 }}>
                            Change Owner
                          </Button>
                          <Button
                            onClick={deleteHandler}
                            value={calendar._id}
                            variant="contained"
                            sx={{ width: 100, fontSize: 12 }}>
                            Delete
                          </Button>
                        </React.Fragment>
                      )}
                    </ListItem>
                    {!calendars.length === index + 1 && (
                      <Divider sx={{ mx: 2, my: 0.5 }} />
                    )}
                  </React.Fragment>
                ))}
              </List>
            </Grid>
          </Container>
        </Card>
      </React.Fragment>
    );
  }
  return null;
};

export default EditCalendars;
