const moment = require("moment-timezone");

const HttpError = require("../models/http-error");
const { validationResult } = require("express-validator");

const Event = require("../models/event-model");
const { maxEndTime } = require("../util/max-end-time");

const getEvents = async (req, res, next) => {
  let events;
  try {
    events = await Event.find().exec();
  } catch (err) {
    const error = new HttpError("Could not found events", 500);
    return next(error);
  }

  res.json({
    events: events.map((event) => event.toObject({ getters: true })),
  });
};

const getIntersectionEventsByDay = async (req, res, next) => {
  const inputCalendar = req.params.calendarId;
  const inputDate = req.params.date;
  const timezone = decodeURIComponent(req.params.timezone);

  const divMinute = 15;

  // 입력받은 timezone을 이용하여 inputDate를 변환
  // 특정 지역 날짜 + 특정 지역 timezone = UTC
  const utcInputDate = moment.tz(inputDate + " 00:00", timezone).utc();
  // YYYY-MM-DDT00:00:00+09:00
  // {startTime :{"$gte":ISODate('2022-01-22T00:00:00Z')}}

  // MongoDB stores dates as 64-bit integers,
  // which means that Mongoose does not store timezone information by default.
  // When you call Date#toString(), the JavaScript runtime will use your OS' timezone.

  let events;
  try {
    events = await Event.find({
      calendar: inputCalendar,
      startTime: {
        $gte: new Date(utcInputDate).toISOString(),
        $lt: new Date(
          utcInputDate.add({ hours: 23, minutes: 59 })
        ).toISOString(),
      },
    })
      .sort({ startTime: 1, endTime: 1 })
      .select({ title: 0, calendar: 0 });
  } catch (err) {
    console.log(err);
    const error = new HttpError(
      "Querying events error, please try again.",
      500
    );
    return next(error);
  }

  if (events.length === 0) {
    const error = new HttpError("Does not exist event Data.", 404);
    return next(error);
  }

  const initTime = moment.tz(events[0].startTime, timezone);
  const lastTime = moment.tz(maxEndTime(events), timezone);
  const lastDiffInitDiv = lastTime.diff(initTime, "minutes") / divMinute;
  let members = [];
  let allSchedule = [];

  // 행 채우기
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    members[eventIndex] = events[eventIndex].creator;
    let start = moment.tz(events[eventIndex].startTime, timezone);
    let end = moment.tz(events[eventIndex].endTime, timezone);
    let endDiffStartDiv = end.diff(start, "minutes") / divMinute;
    let startDiffInitDiv = start.diff(initTime, "minutes") / divMinute;
    let schedule = [];
    // 열 채우기
    for (
      let scheduleIndex = 0;
      scheduleIndex < lastDiffInitDiv;
      scheduleIndex++
    ) {
      if (
        (scheduleIndex === 0 && startDiffInitDiv === 0) ||
        scheduleIndex === startDiffInitDiv
      ) {
        schedule[scheduleIndex] = "S";
      } else if (scheduleIndex === endDiffStartDiv + startDiffInitDiv - 1) {
        schedule[scheduleIndex] = "E";
      } else if (
        scheduleIndex > startDiffInitDiv &&
        scheduleIndex < endDiffStartDiv + startDiffInitDiv - 1
      ) {
        schedule[scheduleIndex] = "1";
      } else {
        schedule[scheduleIndex] = "0";
      }
    }
    allSchedule.push(schedule);
  }

  console.log("allSchedule: " + allSchedule);
  console.log("events: " + events);

  let intersectionStart = [];
  let intersectionMembers = [];
  let intersectionJson = [];
  let intersectionCount = 0;

  for (let timeDivIndex = 0; timeDivIndex < lastDiffInitDiv; timeDivIndex++) {
    let endFlag = 0;
    for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
      // 이벤트의 시작인 경우
      if (allSchedule[memberIndex][timeDivIndex] === "S") {
        // 시작 시간을 기록
        intersectionMembers.push(members[memberIndex]);
        intersectionStart.push(timeDivIndex);
        intersectionCount = intersectionCount + 1;
      }
      // 이벤트의 끝인 경우
      else if (
        endFlag === 0 &&
        allSchedule[memberIndex][timeDivIndex] === "E" &&
        intersectionCount >= 2
      ) {
        // E를 만난 경우, 현재의 인덱스를 저장
        console.log("intersectionMembers: " + intersectionMembers);
        console.log("intersectionStart: " + intersectionStart);
        endFlag = 1;
        let endMembers = [];
        let minDiv = lastDiffInitDiv;

        for (
          let findEndTimeMemberIndex = memberIndex;
          findEndTimeMemberIndex < members.length;
          findEndTimeMemberIndex++
        ) {
          if (allSchedule[findEndTimeMemberIndex][timeDivIndex] === "E") {
            endMembers.push({
              index: findEndTimeMemberIndex,
              memberId: members[findEndTimeMemberIndex],
              startTimeDiv: intersectionStart[findEndTimeMemberIndex],
            });
            timeDivIndex - intersectionStart[findEndTimeMemberIndex] < minDiv
              ? (minDiv = intersectionStart[findEndTimeMemberIndex])
              : null;
          }
        }
        console.log("memberIndex: " + endMembers[0].index);
        console.log("memberId: " + endMembers[0].memberId);
        console.log("startTimeDiv: " + endMembers[0].startTimeDiv);
        console.log("endTimeIndex:" + timeDivIndex);

        console.log("minDiv: " + minDiv);
        // 교집합 작성 시작
        let currentDiv = timeDivIndex;
        for (
          let i = intersectionMembers.length - 1;
          intersectionStart[i] >= minDiv;
          i--
        ) {
          console.log("currentDiv: " + currentDiv);
          if (intersectionStart[i] < currentDiv) {
            // 출력용 JSON 작성
            intersectionJson.push({
              startTime: moment
                .tz(events[0].startTime, timezone)
                .add(intersectionStart[i] * divMinute, "minutes"),
              endTime: moment
                .tz(events[0].startTime, timezone)
                .add(timeDivIndex * divMinute, "minutes"),
              members: intersectionMembers.slice(0, i + 1).filter((data) => {
                return data !== "";
              }), // 멤버 배열 공백 제거
              depth: currentDiv - intersectionStart[i],
            });
            currentDiv = intersectionStart[i];
          }
        }

        // 교집합 작성 완료된 멤버는 교집합 pool에서 제외
        for (let i = 0; i < endMembers.length; i++) {
          intersectionMembers[endMembers[i].index] = "";
          intersectionStart[endMembers[i].index] = "";
          intersectionCount = intersectionCount - 1;
        }
      }
      // 세로로 순회 중, S 다음에 0이 나온 경우 (순회 끝)
      else if (
        memberIndex > 0 &&
        allSchedule[memberIndex][timeDivIndex] === "0"
      ) {
        if (allSchedule[memberIndex - 1][timeDivIndex] === "S") {
          continue;
        }
      }
    }
  }
  console.log(intersectionStart);
  console.log(intersectionJson);

  res.status(201).json({ events: intersectionJson });

  // events 변수 자체가 커서인듯...
  // https://stackoverflow.com/questions/37024829/cursor-map-toarray-vs-cursor-toarray-thenarray-array-map

  // .../api/calendar/:calendarId/date/:day
  // .../api/calendar/:calendarId/month/:yearmonth
  // .../api/calendar/:calendarId/fixed-event/timezone/:timezone
  // input 정보로 Timezone도 필요함
  // 쿼리를 쓰는 것이 좋은가? 필터를 사용해야 하는 것 같기도 하고..?
  // API URL이 너무 길면 이해하기 힘든 것 아닌가...

  // event model query
  // event.calendar = inputCalendar
  // startDate or endDate 의 년월일 = inputDate
  // mongoose date 객체 검색법을 찾아봐야겠다.
  // 검색 결과 패턴은 3가지.
  // 시작과 끝이 모두 당일 / 시작은 당일, 끝은 다음날
  // MongoDB의 이해도가 낮은 것 같다. 아직 RDB의 SQL처럼 사고하는 것 같다.
  // 캘린더의 멤버 수가 아니라 그 날짜에 등록한 멤버를 구해야 할듯...

  // 1. 특정 캘린더, 특정 날짜의 이벤트를 모두 불러옴
  // 2. 특정 날짜에 이벤트를 등록한 사람 수
  // 3. 겹치는 사람 수 = 특정 날짜에 이벤트를 등록한 사람 수

  // 한명일 경우? 교집합 없음
  // 두명 이상부터 -> 교집합 계산 시작
  // 입력자 수 = 교집합 카운트 *BEST*
  // 과반수 이상인 교집합을 구해서 ... 차순위로 보여주는 게 좋지 않을까?

  // 결과를 순회하면서 배열을 3개 만듦.
  // startTime, endTime, user
  // startTime 의 갯수와 endTime의 갯수는 반드시 같음. user는 중복이 있을 수 있음.
  // user 배열에서 입력자 수를 획득.
  // startTime과 endTime은 세트로 계산해야함. 단순하게 값을 각각 따로 나열하여 비교하는 걸로는 교집합을 구할 수 없음...(어찌보면 당연한)
  // startTime 의 오름차 순으로 객체를 정렬한 뒤, 15분 단위로 판단이 들어가야 하나? 이게 맞을 지도..
  // 프론트에서 값 입력도 15분 단위로 받자.
  // 루프는 좀 돌겠지만 이게 단순할지도...

  // 교집합을 찾는 방법
  // 교집합 객체: id, startTime, endTime
  // 1. 15분 단위로 판단을 하여 교집합 카운터를 증가, 감소 시킴
  // JS 배열 쓰는 법을 알아야 할듯... 객체를 빼내는 건 가능한가? key 항목만 있으면 가능한가?
  // splice 함수를 사용하여 간단하게 가능! 그럼 이게 나을려나...
  //
  // 2. 2차원 배열을 만든다. 사람수 x 최소 시작 시간~최대 종료 시간 (15분 단위)
  // 최소 시작 시간은 정렬하면 나오지만... 최대 종료 시간은 어떻게 구하지(종료시간 기준 정렬?)
  // 시작시간은 S, 시작과 종료 사이는 1, 종료는 E, 빈 시간은 0
  // S가 들어오면 시작시간 갱신, 카운터 증가, 멤버 추가
  // E가 들어오면 종료시간 갱신, 교집합 갱신(카운터, 멤버, 시작&종료), 멤버 제외, 카운터 감소.
};

const getIntersectionEventsByMonth = async (req, res, next) => {};

const getEventsByDate = async (req, res, next) => {
  const inputDate = req.params.date;
  // input: 달력 정보, 날짜, 유저의 위치 정보

  // check:
  // 유효한 날짜 형식인지?
  // 요청하는 달력이 이 유저가 속한 달력인지?
  // 관리자인지?: 관리자면 일정 확정 권한을 줘야 함 <- 프론트가 할일?

  // 필요한 정보:
  // 입력받은 timezone 기준으로 일정을 계산
  // 입력받은 날짜를 기준으로 starTime 혹은 endTime가 그 날짜 안에 있는 경우
  // 입력: 2021-01-01 -> start가 2021-12-31이어도 end가 2021-01-01에 있으면 추출 대상
  // 달력: 속한 유저들
  // 이벤트: 속한 유저들의 일정들

  // 출력할 정보
  // timezone 기준으로 추출한 달력에 속한 유저들의 일정
  // 일정들의 교집합(계산)
  //

  let events;
  try {
    events = await Event.find().exec();
  } catch (err) {
    const error = new HttpError("Could not found events", 500);
    return next(error);
  }

  res.json({
    events: events.map((event) => event.toObject({ getters: true })),
  });
};

const createEvents = async (req, res, next) => {
  const regexDate = RegExp(/^\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])$/);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new HttpError(
      "Invalid inputs passed, please check your data.",
      422
    );
    return next(error);
  }

  const { date, startTime, endTime, timezone, timezoneOffset } = req.body;

  let addDay = 0;
  const startDate = moment.tz("2022-01-01" + " " + startTime, timezone);
  const endDate = moment.tz("2022-01-01" + " " + endTime, timezone);

  if (!startDate.isValid() || !endDate.isValid()) {
    const error = new HttpError("Invalid Time Value", 500);
    return next(error);
  }
  startDate > endDate ? (addDay = 1) : null;

  let insertEventsArray = [];

  const timezoneTo5Digit = (timezone) => {
    let timezoneReturn;
    if (typeof timezone === "number" && timezone >= -11 && timezone <= 14) {
      if (timezone > 0) {
        timezone.toString().length === 1
          ? (timezoneReturn = "+0" + timezone.toString() + "00")
          : (timezoneReturn = "+" + timezone.toString() + "00");
      } else {
        timezone.toString().length === 2
          ? (timezoneReturn = "-0" + timezone.toString().charAt(1) + "00")
          : (timezoneReturn = timezone.toString() + "00");
      }
    } else {
      const error = new HttpError("Invalid timezone value", 500);
      return next(error);
    }

    return timezoneReturn;
  };

  date.forEach((value, index, array) => {
    if (!regexDate.test(value)) {
      const error = new HttpError("Invalid Date value", 500);
      return next(error);
    }
    insertEventsArray.push({
      title:
        addDay === 1
          ? startTime + "~(next day)" + endTime
          : startTime + "~" + endTime,

      startTime: moment.tz(value + " " + startTime, timezone),
      endTime: moment.tz(value + " " + endTime, timezone).add(addDay, "day"),
    });
  });

  try {
    await Event.insertMany(insertEventsArray);
  } catch (err) {
    console.log(err);
    const error = new HttpError(
      "Creating Events failed, please try again.",
      500
    );
    return next(error);
  }

  res.status(201).json({ events: insertEventsArray });

  // data validation

  // date: 배열, 순회하면서 확인
  // startTime: 시간, 확인
  // endTime: 시간, 확인
  // timezone: -11 ~ 14 사이의 숫자
  // timezoneOffset: 문자열, 참고용으로 받음
};

exports.getEvents = getEvents;
exports.createEvents = createEvents;
exports.getEventsByDate = getEventsByDate;
exports.getIntersectionEventsByDay = getIntersectionEventsByDay;
